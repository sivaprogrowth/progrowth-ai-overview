/**
 * Grader query generation.
 *
 * Deterministic templates FIRST — the same company always produces the same
 * base query set, which is what makes the score reproducible and the cost
 * predictable. An optional single LLM call can append a few context-specific
 * queries; it is off unless GRADER_LLM_QUERIES=true, and anything it returns
 * is filtered through the repo's debunked-tactic guardrail
 * (lib/recommendations.instructsDebunkedTactic) exactly as
 * lib/promptGenerator.ts does for the internal product.
 *
 * Four intent categories, because a brand that only wins its own name is
 * invisible where buyers actually start:
 *   A category_discovery      "best X companies in Y"        (high)
 *   B recommendation_intent   "which X should I use?"        (high)
 *   C brand_evaluation        "Acme reviews"                 (medium)
 *   D alternatives_comparison "Acme alternatives"            (medium)
 *
 * lib/promptGenerator.ts is deliberately NOT reused: it is LLM-first, needs
 * a `Client` row, and emits a 25-prompt 5-cluster set for the internal
 * scorecard. The grader needs 8–12 deterministic queries and no tenant.
 *
 * NOTE: '../dataforseo' is imported dynamically inside the enrichment call
 * because it transitively constructs the Supabase client at module load.
 * Keeping the top level import-free lets the templates be unit tested with
 * no environment at all.
 */

import { instructsDebunkedTactic } from '../recommendations'
import type { GeneratedQuery, NormalizedGraderInput, QueryCategory } from './types'

/** Hard ceiling on generated queries — the public cost/latency bound. */
export const MAX_QUERIES = 12
/** Below this the report is not worth producing. */
export const MIN_QUERIES = 8
/** Most extra queries the optional LLM call may contribute. */
export const MAX_LLM_QUERIES = 3

function titleish(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Deterministic template set. Pure — no I/O, no randomness, no Date.
 * Ordering is category round-robin so truncating at MAX_QUERIES can never
 * starve a category.
 */
export function generateTemplateQueries(input: NormalizedGraderInput): GeneratedQuery[] {
  const company = titleish(input.companyName)
  const industry = titleish(input.industry)
  const service = input.service ? titleish(input.service) : industry
  const location = input.location ? titleish(input.location) : null
  const inLoc = location ? ` in ${location}` : ''
  const forLoc = location ? ` in ${location}` : ''

  const byCategory: Record<QueryCategory, string[]> = {
    category_discovery: [
      `best ${service} companies${inLoc}`,
      `top ${service} providers for small businesses${inLoc}`,
      `${service} providers${inLoc}`,
      location ? `${industry} companies in ${location}` : `leading ${industry} companies`,
    ],
    recommendation_intent: [
      `which ${service} company should I use${inLoc}?`,
      `best ${service} provider for a small business${forLoc}`,
      `who should I choose for ${service}${inLoc}?`,
    ],
    brand_evaluation: [
      `${company} reviews`,
      `is ${company} a good ${service} provider?`,
      `${company} pricing and reputation`,
    ],
    alternatives_comparison: [
      `${company} alternatives`,
      `companies similar to ${company}`,
      `${company} competitors`,
    ],
  }

  const priority: Record<QueryCategory, GeneratedQuery['priority']> = {
    category_discovery: 'high',
    recommendation_intent: 'high',
    brand_evaluation: 'medium',
    alternatives_comparison: 'medium',
  }

  const order: QueryCategory[] = [
    'category_discovery',
    'recommendation_intent',
    'brand_evaluation',
    'alternatives_comparison',
  ]

  const out: GeneratedQuery[] = []
  const seen = new Set<string>()
  const maxDepth = Math.max(...order.map((c) => byCategory[c].length))

  for (let depth = 0; depth < maxDepth; depth++) {
    for (const category of order) {
      const query = byCategory[category][depth]
      if (!query) continue
      const key = query.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ query, category, priority: priority[category], source: 'template' })
    }
  }

  return out.slice(0, MAX_QUERIES)
}

/**
 * Parse the enrichment call's answer. Accepts a JSON array of strings or a
 * newline/numbered list — LLMs drift between the two and a strict parser
 * would just throw away a usable response.
 */
export function parseLlmQueries(text: string): string[] {
  if (!text) return []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text

  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(body.slice(start, end + 1))
      if (Array.isArray(arr)) {
        return arr.map((x) => String(x).trim()).filter(Boolean)
      }
    } catch {
      // fall through to the line parser
    }
  }

  return body
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["']|["',]+$/g, '').trim())
    .filter((l) => l.length >= 8 && l.length <= 120 && !l.endsWith(':'))
}

/**
 * The optional single LLM call. Returns [] on ANY failure — query generation
 * must never be able to fail the run, because the template set alone is a
 * complete, valid query plan.
 *
 * The prompt is kept under the DataForSEO 500-char user_prompt ceiling
 * (documented in lib/dataforseo.ts — longer prompts 40501).
 */
export async function generateLlmQueries(
  input: NormalizedGraderInput,
  existing: GeneratedQuery[]
): Promise<{ queries: GeneratedQuery[]; cost: number; calls: number; error: string | null }> {
  if (process.env.GRADER_LLM_QUERIES !== 'true') {
    return { queries: [], cost: 0, calls: 0, error: null }
  }

  const service = (input.service ?? input.industry).slice(0, 60)
  const location = (input.location ?? '').slice(0, 40)
  const prompt =
    `A buyer is looking for ${service}${location ? ` in ${location}` : ''}. ` +
    `List 3 short real questions such a buyer would ask an AI assistant ` +
    `before choosing a provider. No brand names. Output ONLY a JSON array ` +
    `of 3 strings, no fences.`

  try {
    const { fetchChatgptCompletion } = await import('../dataforseo')
    const res = await fetchChatgptCompletion(prompt.slice(0, 500))
    const seen = new Set(existing.map((q) => q.query.toLowerCase()))
    const queries: GeneratedQuery[] = []

    for (const raw of parseLlmQueries(res.text)) {
      if (queries.length >= MAX_LLM_QUERIES) break
      const query = titleish(raw).slice(0, 120)
      const key = query.toLowerCase()
      if (!query || seen.has(key)) continue
      // Same guardrail the internal prompt generator enforces: never let a
      // generated query coach a Google-debunked "AI optimization" tactic.
      if (instructsDebunkedTactic(query)) continue
      seen.add(key)
      queries.push({ query, category: 'recommendation_intent', priority: 'medium', source: 'llm' })
    }

    return { queries, cost: res.cost, calls: 1, error: null }
  } catch (e) {
    return {
      queries: [],
      cost: 0,
      calls: 1,
      error: e instanceof Error ? e.message : 'query enrichment failed',
    }
  }
}

/**
 * Full query plan: deterministic templates, optionally topped up by the LLM,
 * always capped at MAX_QUERIES.
 */
export async function generateQueries(
  input: NormalizedGraderInput
): Promise<{ queries: GeneratedQuery[]; cost: number; calls: number; warning: string | null }> {
  const templates = generateTemplateQueries(input)
  if (templates.length >= MAX_QUERIES) {
    return { queries: templates, cost: 0, calls: 0, warning: null }
  }

  const extra = await generateLlmQueries(input, templates)
  const queries = [...templates, ...extra.queries].slice(0, MAX_QUERIES)
  return {
    queries,
    cost: extra.cost,
    calls: extra.calls,
    warning: extra.error ? `query enrichment skipped: ${extra.error}` : null,
  }
}
