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
import { getGraderQueryCount, MAX_QUERIES, MIN_QUERIES } from './query-count'
import type { GeneratedQuery, NormalizedGraderInput, QueryCategory } from './types'

/** Re-exported for backward compatibility — see lib/grader/query-count.ts,
 *  which now owns these bounds (avoids a circular import with this file). */
export { MAX_QUERIES, MIN_QUERIES }
/** Most extra queries the optional LLM call may contribute. */
export const MAX_LLM_QUERIES = 3

function titleish(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/**
 * Deterministic template set. Pure — no I/O, no randomness, no Date.
 * Ordering is category round-robin so truncating at `targetCount` can
 * never starve a category down to zero — though it CAN produce an uneven
 * split across categories when `targetCount` isn't a multiple of the
 * category count (4): 12 and 8 both split evenly (3/3/3/3 and 2/2/2/2);
 * 10 does not (3/3/2/2, favoring the two high-priority categories at the
 * expense of the two medium-priority ones — see lib/grader/query-count.ts
 * for why that specific unevenness mattered in the Phase 2 measurements).
 *
 * `targetCount` defaults to MAX_QUERIES (12) so any existing caller that
 * doesn't pass one keeps getting today's full template set unchanged.
 */
export function generateTemplateQueries(
  input: NormalizedGraderInput,
  targetCount: number = MAX_QUERIES
): GeneratedQuery[] {
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

  return out.slice(0, targetCount)
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
 * always capped at the configured target count (lib/grader/query-count.ts —
 * 8 by default as of Phase 2, was a flat 12 before).
 */
export async function generateQueries(
  input: NormalizedGraderInput
): Promise<{ queries: GeneratedQuery[]; cost: number; calls: number; warning: string | null }> {
  const targetCount = getGraderQueryCount()
  const templates = generateTemplateQueries(input, targetCount)
  if (templates.length >= targetCount) {
    return { queries: templates, cost: 0, calls: 0, warning: null }
  }

  const extra = await generateLlmQueries(input, templates)
  const queries = [...templates, ...extra.queries].slice(0, targetCount)
  return {
    queries,
    cost: extra.cost,
    calls: extra.calls,
    warning: extra.error ? `query enrichment skipped: ${extra.error}` : null,
  }
}
