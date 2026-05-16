/**
 * Per-client prompt-set generator (multi-tenant Phase 2).
 *
 * Every client added via /clients/new otherwise inherits ProGrowth's
 * CANONICAL_PROMPTS. This generates a tailored 5-cluster × 25-prompt set
 * (in the exact CanonicalPrompt/PromptCluster shape the geoSeoGap /
 * citationNetwork / scorecard pipeline already consumes) from the client's
 * identity, using the chat_gpt completion endpoint that works on this
 * account tier (llm_mentions 40204s — see lib/geoSeoGap notes).
 *
 * GUARDRAIL (Task 26.9): every generated prompt is run through
 * `instructsDebunkedTactic()` and dropped if it coaches a Google-debunked
 * tactic (llms.txt / AI-chunking / AI-tone rewrite / schema-as-AI-req).
 * Generated prompts must be real buyer-intent queries, never AEO coaching.
 *
 * Cost: ~$0.001 per generation (one gpt-4o-mini completion, cap-guarded).
 */

import { fetchChatgptCompletion } from './dataforseo'
import { instructsDebunkedTactic } from './recommendations'
import type { CanonicalPrompt, PromptCluster, PromptType } from './prompts'

export interface GeneratePromptsInput {
  companyName: string
  primaryDomain: string
  description?: string
  /** Optional free-text hints (industries / service lines) to steer clusters. */
  verticalsHint?: string[]
  /** Configured competitor domains — a few are woven in so the set
   *  includes real "Company vs <competitor>" comparative prompts. */
  competitorSites?: string[]
  /** Products/services to focus prompts on. */
  products?: string[]
  /** Example prompts the human seeded — used as a few-shot style anchor. */
  samplePrompts?: string[]
  /** Ideal-customer-profile / buyer designations description. */
  icpDescription?: string
}

export interface GeneratedPromptSet {
  clusters: PromptCluster[]
  prompts: CanonicalPrompt[]
  /** Prompt texts dropped by the debunked-tactic guardrail (transparency). */
  rejected: string[]
  cost: number
}

const VALID_TYPES: PromptType[] = ['comparative', 'task', 'evaluative', 'ideation']
const TYPE_LETTER: Record<PromptType, string> = {
  comparative: 'c',
  task: 't',
  evaluative: 'e',
  ideation: 'i',
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24)
}

/** Pull the first balanced JSON object out of an LLM answer (tolerates
 *  ```json fences or stray prose around it). */
function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Generator returned no parseable JSON object')
  }
  return JSON.parse(candidate.slice(start, end + 1))
}

/**
 * Build a TERSE prompt. The DataForSEO chat_gpt endpoint hard-rejects
 * user_prompt > ~500 chars (40501), so the dynamic parts are budgeted and
 * truncated and the whole string is kept well under the limit.
 */
// Fixed instruction tail — kept last and intact so the debunked-tactic
// guardrail clause is never truncated by the 500-char clamp.
const PROMPT_TAIL =
  ` Output ONLY minified JSON, no fences: ` +
  `{"clusters":[{"id":"slug","name":"N","description":"d"}],` +
  `"prompts":[{"text":"q","type":"t","cluster":"slug"}]}. ` +
  `Make 5 clusters and 25 real buyer-intent prompts (~5/cluster) for this ` +
  `company's market. t = comparative|task|evaluative|ideation, counts ` +
  `5/5/10/5. Real buyer questions only — never AEO/llms.txt/schema coaching.`

function buildPrompt(input: GeneratePromptsInput): string {
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
  const name = clean(input.companyName).slice(0, 40)
  const domain = clean(input.primaryDomain).slice(0, 40)
  const desc = clean(input.description ?? '')
  const verts = (input.verticalsHint ?? []).map((s) => s.trim()).filter(Boolean).join(',')
  const icp = clean(input.icpDescription ?? '')
  const prods = (input.products ?? []).map((s) => s.trim()).filter(Boolean).join(',')
  const sample = (input.samplePrompts ?? []).map((s) => clean(s)).filter(Boolean)[0] ?? ''
  const comps = (input.competitorSites ?? [])
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(',')

  // Priority-ordered, per-segment-capped head. The whole head is then
  // hard-clamped so head + PROMPT_TAIL stays ≤ 500 (DataForSEO rejects
  // user_prompt > ~500 with a misleading 40501 — see lib/dataforseo.ts /
  // memory dataforseo-chatgpt-user-prompt-500). Lower-priority segments
  // are dropped by the clamp before company/verticals/ICP are touched.
  const seg: string[] = [`Company "${name}" (${domain})`]
  if (desc) seg.push(`— ${desc.slice(0, 70)}`)
  if (verts) seg.push(`Verticals:${verts.slice(0, 36)}`)
  if (icp) seg.push(`ICP:${icp.slice(0, 46)}`)
  if (prods) seg.push(`Products:${prods.slice(0, 38)}`)
  if (sample) seg.push(`Eg:"${sample.slice(0, 46)}"`)
  if (comps) seg.push(`Competitors:${comps.slice(0, 36)}; add "${name} vs <competitor>" prompts`)

  const head = seg.join('. ').slice(0, 500 - PROMPT_TAIL.length - 1) + '.'
  return (head + PROMPT_TAIL).slice(0, 500)
}

/**
 * Generate + normalise + guardrail-filter a tailored prompt set.
 * Throws on hard failure (cap exceeded, unparseable, or nothing usable).
 */
export async function generateClientPrompts(
  input: GeneratePromptsInput
): Promise<GeneratedPromptSet> {
  if (!input.companyName?.trim() || !input.primaryDomain?.trim()) {
    throw new Error('companyName and primaryDomain are required')
  }

  // The DataForSEO chat_gpt endpoint intermittently returns a transient
  // task error (40501 "Invalid Field: 'user_prompt'") or an empty body for
  // a request that succeeds on retry. Retry empty/unparseable responses a
  // few times before giving up; accumulate cost across attempts.
  const prompt = buildPrompt(input)
  let parsed: any = null
  let cost = 0
  let lastErr = ''
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetchChatgptCompletion(prompt)
    cost += res.cost
    if (res.text) {
      try {
        parsed = extractJson(res.text)
        break
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e)
      }
    } else {
      lastErr = 'empty response (transient upstream task error)'
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 800 * attempt))
  }
  if (!parsed) {
    throw new Error(`Generator failed after retries: ${lastErr}`)
  }
  const rawClusters: any[] = Array.isArray(parsed?.clusters) ? parsed.clusters : []
  const rawPrompts: any[] = Array.isArray(parsed?.prompts) ? parsed.prompts : []

  // ── Clusters: slugify ids, dedupe, require name ──
  const clusters: PromptCluster[] = []
  const clusterIds = new Set<string>()
  for (const c of rawClusters) {
    const name = String(c?.name ?? '').trim()
    if (!name) continue
    let id = slugify(String(c?.id ?? name))
    if (!id) continue
    while (clusterIds.has(id)) id = `${id}-x`
    clusterIds.add(id)
    clusters.push({
      id,
      name,
      description: String(c?.description ?? '').trim() || `${name} for ${input.companyName}`,
    })
  }
  if (clusters.length === 0) {
    throw new Error('Generator produced no usable clusters')
  }
  const clusterIdList = clusters.map((c) => c.id)
  const fallbackCluster = clusterIdList[0]

  // ── Prompts: coerce type, remap unknown clusters, guardrail-filter ──
  const prompts: CanonicalPrompt[] = []
  const rejected: string[] = []
  const perTypeCount: Record<string, number> = {}
  for (const p of rawPrompts) {
    const promptText = String(p?.text ?? '').trim()
    if (!promptText) continue

    // 26.9 guardrail — never persist a debunked-tactic prompt.
    if (instructsDebunkedTactic(promptText)) {
      rejected.push(promptText)
      continue
    }

    const type: PromptType = VALID_TYPES.includes(p?.type) ? p.type : 'evaluative'
    const cluster = clusterIdList.includes(String(p?.cluster))
      ? String(p.cluster)
      : fallbackCluster
    const n = (perTypeCount[`${cluster}-${type}`] = (perTypeCount[`${cluster}-${type}`] ?? 0) + 1)
    prompts.push({
      id: `${cluster}-${TYPE_LETTER[type]}${n}`,
      text: promptText,
      type,
      cluster,
    })
  }

  if (prompts.length === 0) {
    throw new Error(
      rejected.length > 0
        ? 'All generated prompts were rejected by the debunked-tactic guardrail — regenerate'
        : 'Generator produced no usable prompts'
    )
  }

  return { clusters, prompts, rejected, cost }
}
