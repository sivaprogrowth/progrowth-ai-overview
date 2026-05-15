/**
 * KPI 5 — GEO/SEO Gap computation.
 *
 * Per /Users/sivam1mac/ProGrowth_GEO_KPI_Scorecard.md, the formula is:
 *
 *   For each tracked prompt:
 *     gap_query = (chatgpt_domains ∩ google_top10_domains) / chatgpt_domains
 *   Aggregate: mean across prompts.
 *
 * Higher gap = better overlap = traditional SEO investment is translating
 * to AI visibility. Lower gap = SEO and GEO are pulling from different
 * source pools — diagnoses where to invest next (Tasks 18 / 21 / 22).
 *
 * Cost: each query costs ~$0.10 (DataForSEO SERP organic) + ~$0.10 (LLM
 * mentions) = ~$0.20 per query. The 5-query probe set runs at ~$1.00 per
 * full measurement. NOT invoked on dashboard page load — only via the
 * /api/cron/geo-seo-gap endpoint, which the user triggers manually or
 * wires to a weekly cron (subtask 20.6).
 */

import { CANONICAL_PROMPTS, PROMPT_CLUSTERS, PROMPT_INDEX_BY_TEXT } from './prompts'

// Note: we deliberately don't use lib/dataforseo's fetchMentionSearch here.
// The llm_mentions/search endpoint requires a subscription tier that isn't
// active on this account ("Access denied. Visit Plans and Subscriptions").
// The chat_gpt/llm_responses endpoint works on the current plan and returns
// the actual ChatGPT answer with citation annotations.

/** Domains that count as ProGrowth for brand-citation checks. */
const PROGROWTH_DOMAINS = new Set(['progrowth.services', 'www.progrowth.services'])

function brandCitedByChatgpt(domains: string[]): boolean {
  return domains.some((d) => PROGROWTH_DOMAINS.has(d.toLowerCase()))
}

function brandRankedByGoogle(domains: string[]): boolean {
  return domains.some((d) => PROGROWTH_DOMAINS.has(d.toLowerCase()))
}

export type RunMode = 'weekly' | 'monthly' | 'auto'

/**
 * UTC check: is this the first Monday of the month? Used by the cron to
 * decide whether to run the cheap 5-prompt probe (every Monday) or the
 * full 25-prompt canonical set (first Monday only).
 */
export function isFirstMondayOfMonth(date: Date = new Date()): boolean {
  return date.getUTCDay() === 1 && date.getUTCDate() <= 7
}

export function resolveRunMode(mode: RunMode = 'auto'): 'weekly' | 'monthly' {
  if (mode === 'auto') return isFirstMondayOfMonth() ? 'monthly' : 'weekly'
  return mode
}

export function getPromptsForMode(mode: 'weekly' | 'monthly'): string[] {
  return mode === 'monthly'
    ? CANONICAL_PROMPTS.map((p) => p.text)
    : GEO_SEO_PROBE_QUERIES
}

/**
 * Seed prompt set for the gap measurement. Picked to span ProGrowth's
 * priority topics so the aggregate gap is representative of the brand's
 * AI-vs-SEO posture, not a single niche. Task 16 (prompt cluster
 * framework) eventually replaces this with the canonical 25-prompt set.
 */
export const GEO_SEO_PROBE_QUERIES = [
  'fractional CMO for B2B SaaS',
  'fractional marketing services for professional services firms',
  'AI marketing agency for financial services',
  'fractional CMO vs marketing agency',
  'best AI marketing automation for accounting firms',
]

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'

function getAuth(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DataForSEO credentials not configured')
  return Buffer.from(`${login}:${password}`).toString('base64')
}

/**
 * Strip URLs down to registrable domains for set comparison.
 * "https://www.bankrate.com/cmo-trends/" → "bankrate.com"
 */
export function extractDomain(input: string | undefined): string | null {
  if (!input) return null
  try {
    const url = input.startsWith('http') ? new URL(input) : new URL(`https://${input}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

/** Pure-math Jaccard overlap: |A ∩ B| / |A|. Returns 0..1. */
export function chatgptToGoogleOverlap(chatgptDomains: string[], googleDomains: string[]): number {
  const aiSet = new Set(chatgptDomains.map((d) => d.toLowerCase()))
  if (aiSet.size === 0) return 0
  const googleSet = new Set(googleDomains.map((d) => d.toLowerCase()))
  let intersection = 0
  aiSet.forEach((d) => {
    if (googleSet.has(d)) intersection += 1
  })
  return intersection / aiSet.size
}

/**
 * Top 10 Google organic domains for a single keyword.
 * Direct call to DataForSEO SERP API (not via the existing dfsPost helper
 * because the SERP organic endpoint has a different cost profile and we
 * want explicit control over the depth + location).
 */
export async function fetchGoogleTop10Domains(keyword: string): Promise<string[]> {
  const res = await fetch(`${DATAFORSEO_BASE}/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getAuth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        keyword,
        location_name: 'United States',
        language_code: 'en',
        depth: 10,
        device: 'desktop',
      },
    ]),
  })
  if (!res.ok) throw new Error(`DataForSEO SERP error ${res.status}`)
  const data = (await res.json()) as any

  const items = data?.tasks?.[0]?.result?.[0]?.items ?? []
  const domains = new Set<string>()
  for (const item of items) {
    if (item.type !== 'organic') continue
    const d = extractDomain(item.domain || item.url)
    if (d) domains.add(d)
  }
  return Array.from(domains)
}

/**
 * Domains that ChatGPT cites when answering a question about `keyword`.
 * Uses DataForSEO's chat_gpt/llm_responses/live endpoint which returns
 * the actual ChatGPT answer with a citations annotations array.
 *
 * Phrases the keyword as a recommendation-seeking question to maximize
 * the chance ChatGPT cites multiple sources rather than answering from
 * pretrained knowledge alone.
 */
export async function fetchChatgptCitedDomains(keyword: string): Promise<string[]> {
  const prompt = `What are the best services for "${keyword}"? List the top 5 companies with their websites and a brief reason for each.`
  const res = await fetch(`${DATAFORSEO_BASE}/ai_optimization/chat_gpt/llm_responses/live`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${getAuth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      {
        user_prompt: prompt,
        model_name: 'gpt-4o-mini',
        web_search: true,
      },
    ]),
  })
  if (!res.ok) return []
  const data = (await res.json()) as any

  const items = data?.tasks?.[0]?.result?.[0]?.items ?? []
  const domains = new Set<string>()
  for (const item of items) {
    // Citations live in item.sections[*].annotations[*].url for type=message
    // (and rarely at item.annotations directly for simpler responses).
    const sections = item?.sections ?? []
    for (const section of sections) {
      for (const ann of section?.annotations ?? []) {
        const d = extractDomain(ann.url)
        if (d) domains.add(d)
      }
    }
    for (const ann of item?.annotations ?? []) {
      const d = extractDomain(ann.url)
      if (d) domains.add(d)
    }
  }
  return Array.from(domains)
}

export interface PerQueryGap {
  query: string
  /** Canonical prompt id (e.g. "fcmo-c") when the query matches the 25-set */
  promptId?: string
  /** Cluster slug ("fcmo", "psm", ...) when known */
  cluster?: string
  /** Rokas Stan prompt type when known */
  promptType?: 'comparative' | 'task' | 'evaluative' | 'ideation'
  chatgptDomains: string[]
  googleDomains: string[]
  overlap: number // 0..1
  /** True if progrowth.services appears in ChatGPT's cited domains */
  brandCitedByChatgpt: boolean
  /** True if progrowth.services appears in Google top-10 organic */
  brandRankedByGoogle: boolean
}

export interface ClusterAggregate {
  clusterId: string
  promptCount: number
  citedCount: number // ChatGPT cited progrowth.services on N of N prompts
  citationShare: number // 0..1 — citedCount / promptCount
  meanOverlap: number // 0..1 — mean Jaccard overlap for this cluster
  googleRankedCount: number // ProGrowth in Google top-10 on N of N
}

export interface GeoSeoGapResult {
  generatedAt: string
  mode: 'weekly' | 'monthly'
  meanOverlap: number // 0..1 — higher means stronger overlap (lower "gap")
  gapPercent: number // 100 * (1 - meanOverlap) — higher means wider gap
  /** Citation share across this run's prompt set (0..1). For weekly, across 5; monthly, across 25. */
  brandCitationShare: number
  /** Per-cluster aggregate stats. Populated when prompts have canonical cluster metadata. */
  byCluster: Record<string, ClusterAggregate>
  queries: PerQueryGap[]
}

/**
 * Run one query end-to-end: fetch ChatGPT cited domains + Google top-10
 * organic in parallel, compute overlap + brand-citation flags, tag with
 * canonical prompt metadata when the query text matches the 25-set.
 */
async function runSingleQuery(q: string): Promise<PerQueryGap> {
  const [chatgpt, google] = await Promise.all([
    fetchChatgptCitedDomains(q).catch(() => []),
    fetchGoogleTop10Domains(q).catch(() => []),
  ])
  const canonical = PROMPT_INDEX_BY_TEXT.get(q.toLowerCase())
  return {
    query: q,
    promptId: canonical?.id,
    cluster: canonical?.cluster,
    promptType: canonical?.type,
    chatgptDomains: chatgpt,
    googleDomains: google,
    overlap: chatgptToGoogleOverlap(chatgpt, google),
    brandCitedByChatgpt: brandCitedByChatgpt(chatgpt),
    brandRankedByGoogle: brandRankedByGoogle(google),
  }
}

/**
 * Run queries in batches to keep DataForSEO concurrency reasonable. Each
 * batch fires in parallel via Promise.all; batches run sequentially.
 * Batch size 8 keeps total wall-clock under 60s even for the full 25-set.
 */
async function runQueriesBatched(queries: string[], batchSize = 8): Promise<PerQueryGap[]> {
  const out: PerQueryGap[] = []
  for (let i = 0; i < queries.length; i += batchSize) {
    const slice = queries.slice(i, i + batchSize)
    const results = await Promise.all(slice.map(runSingleQuery))
    out.push(...results)
  }
  return out
}

/**
 * Main orchestrator. Mode determines the prompt set and tagging:
 *   weekly  → GEO_SEO_PROBE_QUERIES (5 prompts, ~$1/run)
 *   monthly → CANONICAL_PROMPTS (25 prompts, ~$10/run)
 *
 * In monthly mode, the result is enriched with per-cluster aggregates
 * so the dashboard can render KPI 3 cluster breakdown.
 */
export async function computeKpi5GeoSeoGap(
  queries: string[] = GEO_SEO_PROBE_QUERIES,
  mode: 'weekly' | 'monthly' = 'weekly'
): Promise<GeoSeoGapResult> {
  const perQuery = await runQueriesBatched(queries)

  const queriesWithChatgptData = perQuery.filter((q) => q.chatgptDomains.length > 0)
  const meanOverlap =
    queriesWithChatgptData.length > 0
      ? queriesWithChatgptData.reduce((sum, q) => sum + q.overlap, 0) /
        queriesWithChatgptData.length
      : 0

  const citedCount = perQuery.filter((q) => q.brandCitedByChatgpt).length
  const brandCitationShare = perQuery.length > 0 ? citedCount / perQuery.length : 0

  // Per-cluster aggregates — only meaningful when queries are tagged with
  // canonical cluster metadata (i.e., monthly run against the 25-set).
  const byCluster: Record<string, ClusterAggregate> = {}
  for (const cluster of PROMPT_CLUSTERS) {
    const inCluster = perQuery.filter((q) => q.cluster === cluster.id)
    if (inCluster.length === 0) continue
    const cited = inCluster.filter((q) => q.brandCitedByChatgpt).length
    const ranked = inCluster.filter((q) => q.brandRankedByGoogle).length
    const meanOv = inCluster.reduce((sum, q) => sum + q.overlap, 0) / inCluster.length
    byCluster[cluster.id] = {
      clusterId: cluster.id,
      promptCount: inCluster.length,
      citedCount: cited,
      citationShare: cited / inCluster.length,
      meanOverlap: meanOv,
      googleRankedCount: ranked,
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    mode,
    meanOverlap,
    gapPercent: Math.round((1 - meanOverlap) * 1000) / 10, // 0.0..100.0
    brandCitationShare,
    byCluster,
    queries: perQuery,
  }
}
