/**
 * Mention sentiment classification (Task 19).
 *
 * Re-queries the engines for prompts where ProGrowth was cited and
 * classifies each appearance into four GEO-meaningful buckets:
 *
 *   - `recommended` — engine names ProGrowth as one of the answers in
 *     the visible response body. Best outcome: brand surface + traffic.
 *   - `mentioned`   — name appears in body but not as a recommendation
 *     (e.g., a comparison or supporting fact). Neutral exposure.
 *   - `source-only` — ProGrowth appears only in the citation/annotation
 *     footnotes, not in the visible response text. The engine used the
 *     site as a research source but the user never sees the brand.
 *     This is hidden value — counts in citation share metrics but
 *     produces ~zero traffic.
 *   - `negative`    — explicit unfavourable framing in the response.
 *
 * Why not positive/neutral/negative? Because for niche brands like
 * ProGrowth the most common "good news" outcome is source-only — and
 * lumping that as "positive" would mask the fact that we get the cite
 * but no visibility. The four-bucket taxonomy is what an editor
 * actually needs to triage where to invest content.
 *
 * Drives KPI 4 (Sentiment Score) on the GEO Scorecard.
 */

import { ALL_ENGINES, type Engine } from './citationNetwork'

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'

function getAuth(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DataForSEO credentials not configured')
  return Buffer.from(`${login}:${password}`).toString('base64')
}

export type MentionType = 'recommended' | 'mentioned' | 'source-only' | 'negative'

const TYPE_SCORE: Record<MentionType, number> = {
  recommended: 1,
  mentioned: 0.25,
  'source-only': 0,
  negative: -1,
}

export interface MentionClassification {
  promptId: string
  cluster: string
  engine: Engine
  query: string
  /** Numeric −1 to +1 for averaging into KPI 4 */
  score: number
  type: MentionType
  /** Excerpt from the response body where ProGrowth appears, or null for source-only */
  snippet: string | null
  reasoning: string
  classifiedAt: string
}

export interface SentimentSummary {
  generatedAt: string
  totalMentions: number
  /** Mean score across all classifications (−1 to +1) */
  meanScore: number
  byType: Record<MentionType, number>
  classifications: MentionClassification[]
}

// ── Engine response fetching (mirrors citationNetwork.ts) ─────────────────

interface RawEngineResponse {
  text: string
  citedDomains: string[]
}

async function fetchEngineResponse(engine: Engine, keyword: string): Promise<RawEngineResponse | null> {
  const prompt = `What are the best services or providers for "${keyword}"? List 5-10 companies with their websites and a brief reason for each.`

  const config = {
    chatgpt: {
      path: '/ai_optimization/chat_gpt/llm_responses/live',
      body: { user_prompt: prompt, model_name: 'gpt-4o-mini', web_search: true },
    },
    claude: {
      path: '/ai_optimization/claude/llm_responses/live',
      body: { user_prompt: prompt, model_name: 'claude-sonnet-4-5', web_search: true },
    },
    perplexity: {
      path: '/ai_optimization/perplexity/llm_responses/live',
      body: { user_prompt: prompt, model_name: 'sonar', web_search: true },
    },
    gemini: {
      path: '/serp/google/ai_mode/live/advanced',
      body: { keyword, location_name: 'United States', language_code: 'en' },
    },
  } as const

  const cfg = config[engine]
  try {
    const res = await fetch(`${DATAFORSEO_BASE}${cfg.path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${getAuth()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([cfg.body]),
    })
    if (!res.ok) return null
    const data = (await res.json()) as any
    return extractTextAndDomains(engine, data)
  } catch {
    return null
  }
}

function extractTextAndDomains(engine: Engine, data: any): RawEngineResponse {
  const items = data?.tasks?.[0]?.result?.[0]?.items ?? []
  const textParts: string[] = []
  const domains = new Set<string>()

  for (const item of items) {
    for (const section of item?.sections ?? []) {
      if (typeof section?.text === 'string') textParts.push(section.text)
      for (const ann of section?.annotations ?? []) {
        const d = parseDomain(ann.url)
        if (d) domains.add(d)
      }
    }
    if (typeof item?.text === 'string') textParts.push(item.text)
    for (const ann of item?.annotations ?? []) {
      const d = parseDomain(ann.url)
      if (d) domains.add(d)
    }
    for (const ref of item?.references ?? []) {
      const d = parseDomain(ref.url)
      if (d) domains.add(d)
    }
    if (engine === 'gemini') {
      for (const link of item?.links ?? []) {
        const d = parseDomain(link.url)
        if (d) domains.add(d)
      }
    }
  }

  return { text: textParts.join('\n\n'), citedDomains: Array.from(domains) }
}

function parseDomain(input: string | undefined | null): string | null {
  if (!input) return null
  try {
    const url = input.startsWith('http') ? new URL(input) : new URL(`https://${input}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

// ── Mention detection in body text ─────────────────────────────────────────

const PROGROWTH_NAME_PATTERNS = [
  /pro\s*growth(?:\s+services|\s+group)?/gi,
  /progrowth\.services/gi,
]

const PROGROWTH_DOMAINS = new Set(['progrowth.services', 'www.progrowth.services'])

/**
 * Find the snippet around the first ProGrowth mention in the text.
 * Returns null if the name doesn't appear in the body (= source-only).
 * Snippet is ±250 chars around the match, trimmed at sentence boundaries
 * where possible.
 */
function findMentionSnippet(text: string): string | null {
  for (const pattern of PROGROWTH_NAME_PATTERNS) {
    pattern.lastIndex = 0
    const m = pattern.exec(text)
    if (m && m.index !== undefined) {
      const start = Math.max(0, m.index - 250)
      const end = Math.min(text.length, m.index + m[0].length + 250)
      let snippet = text.slice(start, end).trim()
      // Trim to sentence boundary if we cut into the middle of one
      if (start > 0) {
        const firstDot = snippet.indexOf('. ')
        if (firstDot > 0 && firstDot < 80) snippet = snippet.slice(firstDot + 2)
      }
      return snippet
    }
  }
  return null
}

// ── LLM-based framing classifier ───────────────────────────────────────────

const CLASSIFICATION_PROMPT = `You are classifying how a brand is mentioned in an AI assistant's response.

Brand: ProGrowth (progrowth.services) — a B2B marketing agency
Response snippet: """{{snippet}}"""

Pick ONE label that best describes the framing:
- "recommended": the response names ProGrowth as one of the recommended providers / answers to the user's question
- "mentioned": ProGrowth's name appears but not as a primary recommendation (e.g., comparison aside, supporting fact, brief reference)
- "negative": the response says something explicitly unfavourable about ProGrowth

Reply in this EXACT format (one line each, no extra text):
LABEL: <one of recommended|mentioned|negative>
REASONING: <one sentence, max 25 words>`

async function classifyFraming(
  snippet: string
): Promise<{ type: Exclude<MentionType, 'source-only'>; reasoning: string }> {
  const prompt = CLASSIFICATION_PROMPT.replace('{{snippet}}', snippet.slice(0, 2000))
  try {
    const res = await fetch(`${DATAFORSEO_BASE}/ai_optimization/chat_gpt/llm_responses/live`, {
      method: 'POST',
      headers: { Authorization: `Basic ${getAuth()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ user_prompt: prompt, model_name: 'gpt-4o-mini', web_search: false }]),
    })
    if (!res.ok) return { type: 'mentioned', reasoning: 'classifier HTTP error — defaulted to mentioned' }
    const data = (await res.json()) as any
    const text = (data?.tasks?.[0]?.result?.[0]?.items?.[0]?.sections ?? [])
      .map((s: any) => s.text ?? '')
      .join('\n')

    const labelMatch = text.match(/LABEL:\s*(recommended|mentioned|negative)/i)
    const reasoningMatch = text.match(/REASONING:\s*(.+)/i)
    const type = (labelMatch?.[1]?.toLowerCase() as Exclude<MentionType, 'source-only'>) ?? 'mentioned'
    const reasoning = reasoningMatch?.[1]?.trim() ?? 'classifier returned no reasoning'
    return { type, reasoning }
  } catch (e) {
    return { type: 'mentioned', reasoning: `classifier exception — ${(e as Error).message ?? 'unknown'}` }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface AppearanceInput {
  promptId: string
  cluster: string
  engine: Engine
  query: string
}

/**
 * Classify a single ProGrowth appearance by re-querying the engine,
 * checking whether the brand name appears in the visible body, and
 * (if so) asking an LLM to label the framing.
 */
export async function classifyAppearance(
  input: AppearanceInput
): Promise<MentionClassification> {
  const response = await fetchEngineResponse(input.engine, input.query)
  const classifiedAt = new Date().toISOString()

  if (!response) {
    return {
      ...input,
      type: 'source-only',
      score: TYPE_SCORE['source-only'],
      snippet: null,
      reasoning: 'engine response unavailable — could not verify body mention',
      classifiedAt,
    }
  }

  // Sanity-check: ProGrowth must still be cited in this re-fetch.
  // Engine answers vary across runs; if it dropped out, treat as missing.
  const stillCited = response.citedDomains.some((d) => PROGROWTH_DOMAINS.has(d))
  const snippet = findMentionSnippet(response.text)

  if (!stillCited && !snippet) {
    return {
      ...input,
      type: 'source-only',
      score: TYPE_SCORE['source-only'],
      snippet: null,
      reasoning: 'ProGrowth not cited or named in this fresh response (engine variance)',
      classifiedAt,
    }
  }

  if (!snippet) {
    return {
      ...input,
      type: 'source-only',
      score: TYPE_SCORE['source-only'],
      snippet: null,
      reasoning: 'cited in annotations but not named in visible response body',
      classifiedAt,
    }
  }

  const { type, reasoning } = await classifyFraming(snippet)
  return {
    ...input,
    type,
    score: TYPE_SCORE[type],
    snippet,
    reasoning,
    classifiedAt,
  }
}

/**
 * Classify all known ProGrowth appearances from the latest citation
 * network snapshot stored in Supabase.
 *
 * Each appearance costs roughly $0.10 (one engine query + one classifier
 * call). Today's footprint = 2 appearances = ~$0.20 per pass. Scales
 * with brand visibility, which is exactly the right cost model.
 */
export async function classifyAllProgrowthMentions(): Promise<SentimentSummary> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return emptySummary('Supabase not configured')
  }
  const { supabase } = await import('@/lib/supabase')
  const { fetchCitationNetworkSnapshot } = await import('@/lib/citationNetworkFetcher')

  const snapshot = await fetchCitationNetworkSnapshot()
  if (!snapshot || snapshot.progrowthAppearances.length === 0) {
    return emptySummary('no ProGrowth appearances in latest citation network snapshot')
  }

  const inputs: AppearanceInput[] = snapshot.progrowthAppearances.map((a) => ({
    promptId: a.promptId,
    cluster: a.clusterId,
    engine: a.engine,
    query: a.prompt,
  }))

  // Run classifications in parallel (only ~2-10 typical)
  const classifications = await Promise.all(inputs.map((i) => classifyAppearance(i)))

  const byType: Record<MentionType, number> = {
    recommended: 0,
    mentioned: 0,
    'source-only': 0,
    negative: 0,
  }
  for (const c of classifications) byType[c.type]++

  const meanScore =
    classifications.length > 0
      ? classifications.reduce((sum, c) => sum + c.score, 0) / classifications.length
      : 0

  const summary: SentimentSummary = {
    generatedAt: new Date().toISOString(),
    totalMentions: classifications.length,
    meanScore: Math.round(meanScore * 100) / 100,
    byType,
    classifications,
  }

  // Persist as a sentinel analyses row, same pattern as KPI 5 + Task 22
  await supabase.from('analyses').insert({
    email: 'system@progrowth.services',
    domain: '__sentiment_snapshot__',
    keywords: inputs.map((i) => i.query),
    summary: {
      source: 'sentiment',
      totalMentions: summary.totalMentions,
      meanScore: summary.meanScore,
      byType: summary.byType,
      generatedAt: summary.generatedAt,
    },
    rows: classifications.map((c) => ({
      promptId: c.promptId,
      cluster: c.cluster,
      engine: c.engine,
      query: c.query,
      type: c.type,
      score: c.score,
      reasoning: c.reasoning,
      // Truncate snippet to keep row size manageable
      snippet: c.snippet?.slice(0, 600) ?? null,
    })),
  })

  return summary
}

function emptySummary(note: string): SentimentSummary {
  return {
    generatedAt: new Date().toISOString(),
    totalMentions: 0,
    meanScore: 0,
    byType: { recommended: 0, mentioned: 0, 'source-only': 0, negative: 0 },
    classifications: [],
    // @ts-expect-error — informational field, not part of formal contract
    note,
  }
}

// Suppress unused-import warning when ALL_ENGINES isn't referenced elsewhere
void ALL_ENGINES
