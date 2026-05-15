/**
 * KPI 5 — GEO/SEO Gap computation (multi-tenant Phase 1).
 *
 * Per /Users/sivam1mac/ProGrowth_GEO_KPI_Scorecard.md, the formula is:
 *
 *   For each tracked prompt:
 *     gap_query = (chatgpt_domains ∩ google_top10_domains) / chatgpt_domains
 *   Aggregate: mean across prompts.
 *
 * Higher overlap = better translation of SEO investment to AI visibility.
 * Lower overlap = SEO and GEO pull from different source pools → diagnoses
 * where to invest next (Tasks 18 / 21 / 22).
 *
 * Multi-tenant: brand-citation checks consult the client's domain set, and
 * the prompt set falls back to the client's `prompts`/`probe_queries` when
 * present, otherwise the canonical ProGrowth default. The default 5-query
 * `GEO_SEO_PROBE_QUERIES` remains exported for back-compat with the cron
 * route's hand-rolled `?queries=` mode.
 *
 * Cost: each query ~$0.20 (DataForSEO SERP organic + chat_gpt llm_responses).
 * Weekly probe set (5 queries): ~$1.00. Monthly canonical (25 queries):
 * ~$10. NOT invoked on dashboard page load.
 */

import {
  CANONICAL_PROMPTS,
  buildPromptIndex,
  getClustersForClient,
  getPromptsForClient,
} from './prompts'
import { type Client, getBrandDomainSet } from './clients'

// Note: we deliberately don't use lib/dataforseo's fetchMentionSearch here.
// The llm_mentions/search endpoint requires a subscription tier that isn't
// active on this account ("Access denied. Visit Plans and Subscriptions").
// The chat_gpt/llm_responses endpoint works on the current plan and returns
// the actual ChatGPT answer with citation annotations.

function citedDomainsContainBrand(domains: string[], brandSet: Set<string>): boolean {
  return domains.some((d) => brandSet.has(d.toLowerCase()))
}

export type RunMode = 'weekly' | 'monthly' | 'auto'

export function isFirstMondayOfMonth(date: Date = new Date()): boolean {
  return date.getUTCDay() === 1 && date.getUTCDate() <= 7
}

export function resolveRunMode(mode: RunMode = 'auto'): 'weekly' | 'monthly' {
  if (mode === 'auto') return isFirstMondayOfMonth() ? 'monthly' : 'weekly'
  return mode
}

/**
 * Resolve the prompt set for a given client + mode:
 *   weekly  → client.probe_queries (else first 5 of canonical / client.prompts)
 *   monthly → client.prompts (else CANONICAL_PROMPTS)
 *
 * Returned as plain strings so the rest of the pipeline can treat all
 * sources uniformly.
 */
export function getPromptsForMode(mode: 'weekly' | 'monthly', client: Client): string[] {
  if (mode === 'monthly') {
    return getPromptsForClient(client).map((p) => p.text)
  }
  // weekly
  if (client.probe_queries.length > 0) return client.probe_queries
  // Fallback: first 5 of canonical / client prompts
  return getPromptsForClient(client).slice(0, 5).map((p) => p.text)
}

/**
 * Default seed for ProGrowth. Retained as an export because the cron route
 * historically referenced it and several /tmp test scripts hardcode it. New
 * code should prefer `getPromptsForMode('weekly', client)` so other clients
 * get their own probe set.
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

export function extractDomain(input: string | undefined): string | null {
  if (!input) return null
  try {
    const url = input.startsWith('http') ? new URL(input) : new URL(`https://${input}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

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
  promptId?: string
  cluster?: string
  promptType?: 'comparative' | 'task' | 'evaluative' | 'ideation'
  chatgptDomains: string[]
  googleDomains: string[]
  overlap: number
  /** True if the client's brand domain appears in ChatGPT's cited domains */
  brandCitedByChatgpt: boolean
  /** True if the client's brand domain appears in Google top-10 organic */
  brandRankedByGoogle: boolean
}

export interface ClusterAggregate {
  clusterId: string
  promptCount: number
  citedCount: number
  citationShare: number
  meanOverlap: number
  googleRankedCount: number
}

export interface GeoSeoGapResult {
  generatedAt: string
  mode: 'weekly' | 'monthly'
  meanOverlap: number
  gapPercent: number
  brandCitationShare: number
  byCluster: Record<string, ClusterAggregate>
  queries: PerQueryGap[]
}

async function runSingleQuery(
  q: string,
  promptIndex: Map<string, { id: string; cluster: string; type: PerQueryGap['promptType'] }>,
  brandSet: Set<string>
): Promise<PerQueryGap> {
  const [chatgpt, google] = await Promise.all([
    fetchChatgptCitedDomains(q).catch(() => []),
    fetchGoogleTop10Domains(q).catch(() => []),
  ])
  const canonical = promptIndex.get(q.toLowerCase())
  return {
    query: q,
    promptId: canonical?.id,
    cluster: canonical?.cluster,
    promptType: canonical?.type,
    chatgptDomains: chatgpt,
    googleDomains: google,
    overlap: chatgptToGoogleOverlap(chatgpt, google),
    brandCitedByChatgpt: citedDomainsContainBrand(chatgpt, brandSet),
    brandRankedByGoogle: citedDomainsContainBrand(google, brandSet),
  }
}

async function runQueriesBatched(
  queries: string[],
  promptIndex: Map<string, { id: string; cluster: string; type: PerQueryGap['promptType'] }>,
  brandSet: Set<string>,
  batchSize = 8
): Promise<PerQueryGap[]> {
  const out: PerQueryGap[] = []
  for (let i = 0; i < queries.length; i += batchSize) {
    const slice = queries.slice(i, i + batchSize)
    const results = await Promise.all(slice.map((q) => runSingleQuery(q, promptIndex, brandSet)))
    out.push(...results)
  }
  return out
}

/**
 * Main orchestrator. Mode determines the prompt set and tagging:
 *   weekly  → client.probe_queries (5 prompts, ~$1/run)
 *   monthly → client.prompts ?? CANONICAL_PROMPTS (~$10/run)
 *
 * In monthly mode the result includes per-cluster aggregates so the
 * dashboard can render the KPI 3 cluster breakdown.
 */
export async function computeKpi5GeoSeoGap(
  client: Client,
  queries?: string[],
  mode: 'weekly' | 'monthly' = 'weekly'
): Promise<GeoSeoGapResult> {
  const promptSet = queries ?? getPromptsForMode(mode, client)
  const clientPrompts = getPromptsForClient(client)
  const clusters = getClustersForClient(client)
  const brandSet = getBrandDomainSet(client)

  // Reverse-index any client-side prompt by text. Falls back to the global
  // canonical index when the client uses defaults so test/manual
  // `?queries=` invocations still get metadata-tagged.
  const promptIndex = buildPromptIndex(
    clientPrompts.length > 0 ? clientPrompts : CANONICAL_PROMPTS
  ) as unknown as Map<string, { id: string; cluster: string; type: PerQueryGap['promptType'] }>

  const perQuery = await runQueriesBatched(promptSet, promptIndex, brandSet)

  const queriesWithChatgptData = perQuery.filter((q) => q.chatgptDomains.length > 0)
  const meanOverlap =
    queriesWithChatgptData.length > 0
      ? queriesWithChatgptData.reduce((sum, q) => sum + q.overlap, 0) /
        queriesWithChatgptData.length
      : 0

  const citedCount = perQuery.filter((q) => q.brandCitedByChatgpt).length
  const brandCitationShare = perQuery.length > 0 ? citedCount / perQuery.length : 0

  const byCluster: Record<string, ClusterAggregate> = {}
  for (const cluster of clusters) {
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
    gapPercent: Math.round((1 - meanOverlap) * 1000) / 10,
    brandCitationShare,
    byCluster,
    queries: perQuery,
  }
}
