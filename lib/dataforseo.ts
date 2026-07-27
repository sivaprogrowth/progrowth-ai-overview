import { supabase } from '@/lib/supabase'

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'
const DAILY_COST_CAP = parseFloat(process.env.DATAFORSEO_DAILY_CAP || '5')

function getAuth(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DataForSEO credentials not configured')
  return Buffer.from(`${login}:${password}`).toString('base64')
}

/**
 * Today's DataForSEO spend, in USD.
 *
 * THROWS on a query failure — it must not answer "$0 spent". This function
 * previously discarded the Supabase error and returned 0, which meant that
 * when `api_cost_log` turned out never to have been created (see
 * migrations/005), the daily cap silently authorised every call for two
 * months. A blind spend guard is worse than no spend guard, because it
 * reads as protection. Fail closed and let the caller 500.
 */
async function getDailySpend(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('api_cost_log')
    .select('cost')
    .eq('date', today)
  if (error) {
    throw new Error(
      `Cannot read api_cost_log — refusing to report spend as $0 (${error.message}). ` +
        `Apply migrations/005_api_cost_log.sql.`
    )
  }
  return (data ?? []).reduce((sum: number, row: any) => sum + parseFloat(row.cost || 0), 0)
}

/**
 * Record the cost of a paid call. Called after the money is already spent,
 * so a failure here must not throw away the caller's result — but it must
 * be visible, because every dropped write blinds the cap by that much.
 */
async function logApiCost(endpoint: string, cost: number, calls: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await supabase.from('api_cost_log').insert({
    date: today,
    endpoint,
    cost,
    calls,
  })
  if (error) {
    console.error(
      `[dataforseo] SPEND NOT RECORDED for ${endpoint} ($${cost}, ${calls} calls): ${error.message}. ` +
        `The daily cap is now under-counting by this amount.`
    )
  }
}

export async function checkDailyCap(): Promise<{ allowed: boolean; spent: number; cap: number }> {
  const spent = await getDailySpend()
  return { allowed: spent < DAILY_COST_CAP, spent, cap: DAILY_COST_CAP }
}

/**
 * Per-call ceiling for the live endpoints.
 *
 * MEASURED, not guessed. A 6-call sequential probe of
 * llm_mentions/search/live on 2026-07-27 (zero concurrency):
 *   6.8s, 9.1s, 14.8s, 16.5s, 22.2s, 32.3s — all HTTP 200 / status 20000
 * Under 10-way concurrency the same endpoint produced a 163s straggler.
 * So the endpoint is inherently slow (median ~17s) and concurrency
 * amplifies the tail; it is not one pathological call.
 *
 * The first version of this constant was 30s, set from a single 10.5s
 * sample. That sits BELOW the observed sequential maximum of 32.3s, so it
 * severed healthy in-flight calls: only 11 of 72 completed and the run
 * still returned 200, publishing 13 unchecked keywords as if checked.
 * A timeout under the provider's normal latency is not a safety net, it
 * is a data-loss generator.
 *
 * 90s clears the sequential max with ~3x headroom and still bounds a
 * concurrency straggler well inside the caller's deadline. Callers must
 * ALSO enforce their own wall-clock deadline — this only bounds one call.
 *
 * Note: an aborted call may still be billed by DataForSEO and cannot be
 * cost-logged, so the daily total under-counts by any aborted call.
 */
const DFS_CALL_TIMEOUT_MS = 90_000

async function dfsPost<T = any>(path: string, body: object[]): Promise<T> {
  const res = await fetch(`${DATAFORSEO_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${getAuth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DFS_CALL_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DataForSEO ${path} failed (${res.status}): ${text}`)
  }
  const json = await res.json() as any

  // A DataForSEO task can FAIL while the HTTP request succeeds: the envelope
  // returns 200 and the failure lives in tasks[].status_code. Measured
  // 2026-07-27 — six concurrent llm_mentions calls returned three 50000
  // ("internal error") tasks, each HTTP 200, each with zero items and $0 cost,
  // after ~50s. Without this check they flow back as a perfectly valid empty
  // result, and a caller cannot tell "the provider broke" from "there are no
  // mentions". That is how a run reports keywords as checked-and-empty when
  // they were never really checked. 20000 = Ok; 20100 = task created.
  const tasks: any[] = Array.isArray(json?.tasks) ? json.tasks : []
  const bad = tasks.find(
    (t) => typeof t?.status_code === 'number' && t.status_code !== 20000 && t.status_code !== 20100
  )
  if (bad) {
    throw new Error(
      `DataForSEO ${path} task failed: status_code=${bad.status_code} ${bad.status_message ?? ''}`.trim()
    )
  }

  // Log cost from response
  const taskCost = json?.cost || 0
  const taskCount = json?.tasks_count || 1
  if (taskCost > 0) {
    // logApiCost already reports its own failures; this catch only stops an
    // unexpected throw from taking down a call whose cost is already sunk.
    logApiCost(path, taskCost, taskCount).catch((err) =>
      console.error(`[dataforseo] cost logging threw for ${path}:`, err)
    )
  }

  return json as T
}

// ── LLM Mentions API (bulk, fast — Google + ChatGPT) ──

// Search mentions for domain + keywords on a platform
export async function fetchMentionSearch(
  targets: Array<{ domain?: string; keyword?: string; match_type?: string; search_filter?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google',
  limit = 100
) {
  return dfsPost('/ai_optimization/llm_mentions/search/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
      limit,
    },
  ])
}

// Aggregated metrics for a domain
export async function fetchAggMetrics(
  targets: Array<{ domain?: string; keyword?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google'
) {
  return dfsPost('/ai_optimization/llm_mentions/aggregated_metrics/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
    },
  ])
}

// Top pages mentioned for keywords
export async function fetchTopPages(
  targets: Array<{ domain?: string; keyword?: string; match_type?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google'
) {
  return dfsPost('/ai_optimization/llm_mentions/top_pages/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
      items_list_limit: 10,
      internal_list_limit: 5,
    },
  ])
}

// Top domains mentioned for keywords
export async function fetchTopDomains(
  targets: Array<{ domain?: string; keyword?: string; match_type?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google'
) {
  return dfsPost('/ai_optimization/llm_mentions/top_domains/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
      items_list_limit: 10,
      internal_list_limit: 5,
    },
  ])
}

// ── AI Keyword Data ──

export async function fetchKeywordVolume(keywords: string[]) {
  return dfsPost('/ai_optimization/ai_keyword_data/keywords_search_volume/live', [
    {
      keywords,
      language_code: 'en',
      location_name: 'United States',
    },
  ])
}

// ── Live LLM Queries (Perplexity + Claude) ──

export async function fetchLlmResponse(
  keyword: string,
  llmType: 'perplexity' | 'claude',
  modelName: string,
  customPrompt?: string
) {
  const prompt = customPrompt || `What are the best companies and websites for "${keyword}"? List specific company names, their website URLs, and briefly explain why each is recommended.`
  return dfsPost(`/ai_optimization/${llmType}/llm_responses/live`, [
    {
      llm_type: llmType,
      model_name: modelName,
      user_prompt: prompt.slice(0, 500),
      web_search: true,
    },
  ])
}

// ── Domain Discovery (Ranked Keywords) ──

export async function fetchRankedKeywords(
  domain: string,
  limit = 30
): Promise<Array<{ keyword: string; search_volume: number; position: number }>> {
  const response = await dfsPost('/dataforseo_labs/google/ranked_keywords/live', [
    {
      target: domain,
      language_code: 'en',
      location_name: 'United States',
      limit,
      item_types: ['organic'],
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
      filters: [['keyword_data.keyword_info.search_volume', '>', 20]],
    },
  ])

  const items = response?.tasks?.[0]?.result?.[0]?.items || []

  return items.map((item: any) => ({
    keyword: item.keyword_data?.keyword || '',
    search_volume: item.keyword_data?.keyword_info?.search_volume || 0,
    position: item.ranked_serp_element?.serp_item?.rank_absolute || 0,
  })).filter((k: any) => k.keyword.length > 0)
}

export function filterDiscoveredKeywords(
  keywords: Array<{ keyword: string; search_volume: number; position: number }>,
  domain: string
): string[] {
  const domainParts = domain.toLowerCase().replace(/\.(com|net|org|io|services|co)$/, '').split('.')

  return keywords
    .filter((k) => {
      const kw = k.keyword.toLowerCase()
      if (kw.split(/\s+/).length < 2) return false
      if (domainParts.some((part) => kw.includes(part) && part.length > 3)) return false
      if (kw.includes('http') || kw.includes('.com') || kw.includes('.org')) return false
      return true
    })
    .map((k) => k.keyword)
}

// Extract broader 2-word core phrases from long-tail keywords for richer query discovery
export function extractCorePhrases(keywords: string[]): string[] {
  const stopWords = new Set(['for', 'the', 'a', 'an', 'to', 'in', 'of', 'and', 'or', 'how', 'what', 'is', 'are', 'with', 'on', 'by', 'my', 'your', 'do', 'does'])
  const cores = new Set<string>()

  for (const kw of keywords) {
    const words = kw.toLowerCase().split(/\s+/).filter((w) => !stopWords.has(w) && w.length > 2)
    // Extract meaningful 2-word pairs
    if (words.length >= 3) {
      // Take first 2 content words as core phrase
      cores.add(words.slice(0, 2).join(' '))
      // Also try last 2 content words
      cores.add(words.slice(-2).join(' '))
    }
  }

  // Remove cores that are already in the original keywords
  const kwSet = new Set(keywords.map((k) => k.toLowerCase()))
  return Array.from(cores).filter((c) => !kwSet.has(c))
}

export const LLM_MODELS = {
  perplexity: 'sonar',
  claude: 'claude-haiku-4-5',
} as const

// ── On-Page Technical Audit (indexability + Core Web Vitals) ──
//
// Used by lib/aiReadiness.ts (KPI 6). Per Google's AI optimization guide,
// eligibility for AI Overviews / AI Mode is *exactly* core Search snippet
// eligibility — there is no AI-specific requirement. These two endpoints
// cover the two automatable gates: indexability and page experience.
//
// Both are paid DataForSEO endpoints, so each call is guarded by
// checkDailyCap() and throws DataForSeoCapExceededError if the daily
// spend cap (DATAFORSEO_DAILY_CAP) is already reached. dfsPost() logs the
// actual cost from the response into api_cost_log.

export class DataForSeoCapExceededError extends Error {
  constructor(public spent: number, public cap: number) {
    super(`DataForSEO daily cost cap reached ($${spent.toFixed(2)} / $${cap}). Skipping paid on-page call.`)
    this.name = 'DataForSeoCapExceededError'
  }
}

async function assertUnderCap(): Promise<void> {
  const { allowed, spent, cap } = await checkDailyCap()
  if (!allowed) throw new DataForSeoCapExceededError(spent, cap)
}

export interface OnPageInstantResult {
  url: string
  statusCode: number
  fetchTimeMs: number | null
  title: string | null
  description: string | null
  canonical: string | null
  wordCount: number | null
  isHttps: boolean | null
  /** Full DataForSEO on-page `checks` boolean map (is_https, canonical, is_redirect, is_4xx_code, …). */
  checks: Record<string, boolean>
  cost: number
  /** Raw page item — aiReadiness.ts drills in for anything not normalized here. */
  raw: any
}

/**
 * DataForSEO On-Page Instant Pages (~$0.0006/page). Crawls one URL with
 * JS/browser rendering on and returns normalized indexability signals.
 * Note: noindex / nosnippet / X-Robots-Tag detection is done separately in
 * aiReadiness.ts via a direct fetch of the page HTML + headers, since those
 * directives are exact, free, and not reliably surfaced by this endpoint.
 */
export async function fetchOnPageInstant(url: string): Promise<OnPageInstantResult> {
  await assertUnderCap()
  const json = await dfsPost('/on_page/instant_pages', [
    {
      url,
      enable_javascript: true,
      enable_browser_rendering: true,
      load_resources: true,
    },
  ])
  const item = json?.tasks?.[0]?.result?.[0]?.items?.[0] ?? {}
  const meta = item.meta ?? {}
  return {
    url: item.url ?? url,
    statusCode: item.status_code ?? 0,
    fetchTimeMs: item.page_timing?.duration_time ?? item.fetch_time ?? null,
    title: meta.title ?? null,
    description: meta.description ?? null,
    canonical: meta.canonical ?? null,
    wordCount: meta.content?.plain_text_word_count ?? null,
    isHttps: typeof item.checks?.is_https === 'boolean' ? item.checks.is_https : null,
    checks: item.checks ?? {},
    cost: json?.cost ?? 0,
    raw: item,
  }
}

export interface OnPageLighthouseResult {
  /** Lighthouse performance category score, 0–100 (null if unavailable). */
  performanceScore: number | null
  /** Largest Contentful Paint, ms. Google "good" ≤ 2500. */
  lcpMs: number | null
  /** Cumulative Layout Shift, unitless. Google "good" ≤ 0.1. */
  cls: number | null
  /** Total Blocking Time, ms — lab proxy for INP. Google "good" INP ≤ 200. */
  tbtMs: number | null
  fcpMs: number | null
  speedIndexMs: number | null
  cost: number
  raw: any
}

/**
 * DataForSEO On-Page Lighthouse live JSON (~$0.004/page), mobile profile.
 * Returns the Core Web Vitals lab metrics mapped to Google's page-experience
 * thresholds. Response mirrors Google's Lighthouse JSON (audits keyed by id,
 * numericValue in ms; categories.performance.score 0–1).
 */
export async function fetchOnPageLighthouse(url: string): Promise<OnPageLighthouseResult> {
  await assertUnderCap()
  // NOTE: the live/json endpoint does NOT accept an `audits` request field —
  // sending it returns task error 40501 "Invalid Field: 'audits'" (cost 0,
  // no result). Request only `categories`; the full Lighthouse `audits` map
  // comes back in result[0].audits and is parsed below.
  const json = await dfsPost('/on_page/lighthouse/live/json', [
    {
      url,
      for_mobile: true,
      categories: ['performance'],
    },
  ])
  const result = json?.tasks?.[0]?.result?.[0] ?? {}
  const audits = result.audits ?? result?.lighthouse_result?.audits ?? {}
  const categories = result.categories ?? result?.lighthouse_result?.categories ?? {}
  const num = (id: string): number | null => {
    const v = audits?.[id]?.numericValue
    return typeof v === 'number' ? Math.round(v * 1000) / 1000 : null
  }
  const perfScore = categories?.performance?.score
  return {
    performanceScore: typeof perfScore === 'number' ? Math.round(perfScore * 100) : null,
    lcpMs: num('largest-contentful-paint'),
    cls: num('cumulative-layout-shift'),
    tbtMs: num('total-blocking-time'),
    fcpMs: num('first-contentful-paint'),
    speedIndexMs: num('speed-index'),
    cost: json?.cost ?? 0,
    raw: result,
  }
}

// ── ChatGPT free-form completion (text generation) ────────────────────────
//
// Uses the same chat_gpt/llm_responses endpoint geoSeoGap relies on (works
// on this account tier — unlike llm_mentions which 40204s). Returns the
// concatenated answer text. Cap-guarded; dfsPost logs the (~$0.001) cost.
// `webSearch` defaults false for deterministic generation tasks.

export interface ChatgptCompletion {
  text: string
  cost: number
}

export async function fetchChatgptCompletion(
  userPrompt: string,
  opts: { webSearch?: boolean; modelName?: string } = {}
): Promise<ChatgptCompletion> {
  await assertUnderCap()
  // HARD LIMIT: this endpoint rejects user_prompt > ~500 chars with a
  // misleading task error 40501 "Invalid Field: 'user_prompt'" (verified
  // empirically: 500 OK, 550+ fails). Callers must keep prompts terse.
  const json = await dfsPost('/ai_optimization/chat_gpt/llm_responses/live', [
    {
      user_prompt: userPrompt.slice(0, 500),
      model_name: opts.modelName ?? 'gpt-4o-mini',
      web_search: opts.webSearch ?? false,
    },
  ])
  const items = json?.tasks?.[0]?.result?.[0]?.items ?? []
  const parts: string[] = []
  for (const item of items) {
    if (typeof item?.text === 'string' && item.text.trim()) parts.push(item.text)
    for (const section of item?.sections ?? []) {
      if (typeof section?.text === 'string' && section.text.trim()) parts.push(section.text)
    }
  }
  return { text: parts.join('\n').trim(), cost: json?.cost ?? 0 }
}
