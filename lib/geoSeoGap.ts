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

import { fetchMentionSearch } from './dataforseo'

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
 * Domains that ChatGPT cites in its answer to `keyword`. Reuses the
 * existing fetchMentionSearch helper which queries the LLM Mentions API
 * for the chat_gpt platform.
 */
export async function fetchChatgptCitedDomains(keyword: string): Promise<string[]> {
  const target = [{ keyword, match_type: 'partial_match' as const, search_scope: ['any' as const] }]
  const res = (await fetchMentionSearch(target, 'chat_gpt', 100).catch(() => null)) as any
  if (!res?.tasks) return []
  const domains = new Set<string>()
  for (const task of res.tasks) {
    for (const result of task?.result ?? []) {
      for (const item of result?.items ?? []) {
        const d = extractDomain(item.url || item.domain)
        if (d) domains.add(d)
      }
    }
  }
  return Array.from(domains)
}

export interface PerQueryGap {
  query: string
  chatgptDomains: string[]
  googleDomains: string[]
  overlap: number // 0..1
}

export interface GeoSeoGapResult {
  generatedAt: string
  meanOverlap: number // 0..1 — higher means stronger overlap (lower "gap")
  gapPercent: number // 100 * (1 - meanOverlap) — higher means wider gap
  queries: PerQueryGap[]
}

/**
 * Main orchestrator. Runs each probe query in parallel, computes per-query
 * Jaccard overlap, returns aggregate + breakdown.
 *
 * Returns null for `gapPercent` if all queries returned empty ChatGPT
 * domain sets (e.g., DataForSEO mention search throttling, missing
 * credentials) — caller should treat that as a transient failure, not a
 * meaningful "0% gap."
 */
export async function computeKpi5GeoSeoGap(
  queries: string[] = GEO_SEO_PROBE_QUERIES
): Promise<GeoSeoGapResult> {
  const perQuery = await Promise.all(
    queries.map(async (q): Promise<PerQueryGap> => {
      const [chatgpt, google] = await Promise.all([
        fetchChatgptCitedDomains(q).catch(() => []),
        fetchGoogleTop10Domains(q).catch(() => []),
      ])
      return {
        query: q,
        chatgptDomains: chatgpt,
        googleDomains: google,
        overlap: chatgptToGoogleOverlap(chatgpt, google),
      }
    })
  )

  const queriesWithChatgptData = perQuery.filter((q) => q.chatgptDomains.length > 0)
  const meanOverlap =
    queriesWithChatgptData.length > 0
      ? queriesWithChatgptData.reduce((sum, q) => sum + q.overlap, 0) /
        queriesWithChatgptData.length
      : 0

  return {
    generatedAt: new Date().toISOString(),
    meanOverlap,
    gapPercent: Math.round((1 - meanOverlap) * 1000) / 10, // 0.0..100.0
    queries: perQuery,
  }
}
