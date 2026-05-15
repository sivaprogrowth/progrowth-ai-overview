/**
 * GEO KPI Scorecard data layer.
 *
 * Five KPIs defined in /Users/sivam1mac/ProGrowth_GEO_KPI_Scorecard.md.
 * This module fetches whatever data is currently measurable; KPIs gated on
 * pending plan tasks return null and the UI renders a "Pending Task X" state.
 *
 *   KPI 1  AI Crawler Visits     — Matomo CD2 = "AI Crawler"
 *   KPI 2  AI Referral Visits    — Matomo CD2 = "AI Referral"
 *   KPI 3  Citation Share %      — depends on Task 16 (prompt clusters)
 *   KPI 4  Sentiment Score       — depends on Task 19 (sentiment classifier)
 *   KPI 5  GEO/SEO Gap %         — depends on Task 22 (citation network) wired
 *                                   with DataForSEO comparison
 */

const MATOMO_URL = process.env.MATOMO_URL || ''
const MATOMO_SITE_ID = process.env.MATOMO_SITE_ID || '1'
const MATOMO_TOKEN_AUTH = process.env.MATOMO_TOKEN_AUTH || ''

const AI_TRAFFIC_TYPE_DIMENSION = '2'

export type KPIStatus = 'on-track' | 'behind' | 'ahead' | 'pending'

export interface KPIPerEngineSlice {
  engine: string
  visits: number
}

export interface KPIWeeklyPoint {
  weekLabel: string // e.g. "May 11"
  visits: number
}

export interface KPICard {
  id: 1 | 2 | 3 | 4 | 5
  name: string
  question: string
  funnelStage: string
  current: number | null
  baseline: number
  target30d: number | string
  target90d: number | string
  unit: string
  status: KPIStatus
  perEngine?: KPIPerEngineSlice[]
  /** How to format the per-engine slice numbers in the UI */
  perEngineUnit?: 'visits' | 'percent'
  /** Visits in the immediately preceding 30-day window (for delta %) */
  previousPeriod?: number | null
  /** Most recent 4 weekly snapshots (oldest first) for sparkline */
  weeklySeries?: KPIWeeklyPoint[]
  source: string
  /** Plain-English caveat shown when the card data is partial or stale */
  caveat?: string
  pendingReason?: string
  warningThreshold?: string
}

/**
 * Compute UTC date ranges as Matomo "YYYY-MM-DD,YYYY-MM-DD" strings:
 *   current   = today-30 .. today
 *   previous  = today-61 .. today-31  (the 30 days immediately before current)
 */
function getDateRanges(): { current: string; previous: string } {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const dayMs = 24 * 60 * 60 * 1000

  const currentEnd = today
  const currentStart = new Date(today.getTime() - 30 * dayMs)
  const previousEnd = new Date(currentStart.getTime() - dayMs)
  const previousStart = new Date(currentStart.getTime() - 31 * dayMs)

  return {
    current: `${fmt(currentStart)},${fmt(currentEnd)}`,
    previous: `${fmt(previousStart)},${fmt(previousEnd)}`,
  }
}

async function matomoCustomDimension(
  dimensionValue: string,
  period: string = 'range',
  date: string = 'last30'
): Promise<{ total: number; perEngine: KPIPerEngineSlice[] }> {
  if (!MATOMO_URL || !MATOMO_TOKEN_AUTH) {
    throw new Error('MATOMO_URL and MATOMO_TOKEN_AUTH env vars are required')
  }

  const url = new URL(`${MATOMO_URL}/index.php`)
  url.searchParams.set('module', 'API')
  url.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  url.searchParams.set('idSite', MATOMO_SITE_ID)
  url.searchParams.set('idDimension', AI_TRAFFIC_TYPE_DIMENSION)
  url.searchParams.set('period', period)
  url.searchParams.set('date', date)
  url.searchParams.set('token_auth', MATOMO_TOKEN_AUTH)
  url.searchParams.set('format', 'JSON')
  url.searchParams.set(
    'segment',
    `dimension${AI_TRAFFIC_TYPE_DIMENSION}==${encodeURIComponent(dimensionValue)}`
  )

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) throw new Error(`Matomo API error: ${res.status}`)
  const dim2Rows = (await res.json()) as Array<{ label: string; nb_visits: number }>
  const totalRow = dim2Rows.find((r) => r.label === dimensionValue)
  const total = totalRow?.nb_visits ?? 0

  // Per-engine breakdown via dimension1 (AI Source)
  const perEngineUrl = new URL(`${MATOMO_URL}/index.php`)
  perEngineUrl.searchParams.set('module', 'API')
  perEngineUrl.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  perEngineUrl.searchParams.set('idSite', MATOMO_SITE_ID)
  perEngineUrl.searchParams.set('idDimension', '1')
  perEngineUrl.searchParams.set('period', period)
  perEngineUrl.searchParams.set('date', date)
  perEngineUrl.searchParams.set('token_auth', MATOMO_TOKEN_AUTH)
  perEngineUrl.searchParams.set('format', 'JSON')
  perEngineUrl.searchParams.set(
    'segment',
    `dimension${AI_TRAFFIC_TYPE_DIMENSION}==${encodeURIComponent(dimensionValue)}`
  )

  const engineRes = await fetch(perEngineUrl.toString(), { cache: 'no-store' })
  const engineRows = engineRes.ok
    ? ((await engineRes.json()) as Array<{ label: string; nb_visits: number }>)
    : []
  const perEngine = engineRows
    .filter((r) => r.label !== 'None' && r.nb_visits > 0)
    .map((r) => ({ engine: r.label, visits: r.nb_visits }))
    .sort((a, b) => b.visits - a.visits)

  return { total, perEngine }
}

/**
 * Fetch visit count for a single date range (Matomo `period=range`,
 * `date=YYYY-MM-DD,YYYY-MM-DD`). Used for previous-period comparison.
 */
async function matomoVisitCountForRange(
  dimensionValue: string,
  dateRange: string
): Promise<number> {
  if (!MATOMO_URL || !MATOMO_TOKEN_AUTH) return 0
  const url = new URL(`${MATOMO_URL}/index.php`)
  url.searchParams.set('module', 'API')
  url.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  url.searchParams.set('idSite', MATOMO_SITE_ID)
  url.searchParams.set('idDimension', AI_TRAFFIC_TYPE_DIMENSION)
  url.searchParams.set('period', 'range')
  url.searchParams.set('date', dateRange)
  url.searchParams.set('token_auth', MATOMO_TOKEN_AUTH)
  url.searchParams.set('format', 'JSON')
  url.searchParams.set(
    'segment',
    `dimension${AI_TRAFFIC_TYPE_DIMENSION}==${encodeURIComponent(dimensionValue)}`
  )

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) return 0
  const rows = (await res.json()) as Array<{ label: string; nb_visits: number }>
  return rows.find((r) => r.label === dimensionValue)?.nb_visits ?? 0
}

/**
 * Fetch weekly time series for the last N weeks. Matomo returns an object
 * keyed by week-range strings (e.g. "2026-05-11,2026-05-17") whose value is an
 * array of dimension rows for that week — we extract the matching label.
 */
async function matomoWeeklySeries(
  dimensionValue: string,
  weeks: number = 4
): Promise<KPIWeeklyPoint[]> {
  if (!MATOMO_URL || !MATOMO_TOKEN_AUTH) return []
  const url = new URL(`${MATOMO_URL}/index.php`)
  url.searchParams.set('module', 'API')
  url.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  url.searchParams.set('idSite', MATOMO_SITE_ID)
  url.searchParams.set('idDimension', AI_TRAFFIC_TYPE_DIMENSION)
  url.searchParams.set('period', 'week')
  url.searchParams.set('date', `last${weeks}`)
  url.searchParams.set('token_auth', MATOMO_TOKEN_AUTH)
  url.searchParams.set('format', 'JSON')
  url.searchParams.set(
    'segment',
    `dimension${AI_TRAFFIC_TYPE_DIMENSION}==${encodeURIComponent(dimensionValue)}`
  )

  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) return []
  const data = (await res.json()) as Record<
    string,
    Array<{ label: string; nb_visits: number }> | undefined
  >

  const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return Object.entries(data)
    .map(([range, rows]) => {
      const weekStart = range.split(',')[0]
      const [, m, d] = weekStart.split('-').map((s) => parseInt(s, 10))
      const label = `${monthShort[(m ?? 1) - 1]} ${d}`
      const match = (rows ?? []).find((r) => r.label === dimensionValue)
      return { weekLabel: label, visits: match?.nb_visits ?? 0, _sortKey: weekStart }
    })
    .sort((a, b) => a._sortKey.localeCompare(b._sortKey))
    .map(({ weekLabel, visits }) => ({ weekLabel, visits }))
}

/**
 * KPI 5 — GEO/SEO Gap. Reads the most recent snapshot written by the
 * /api/cron/geo-seo-gap endpoint (sentinel domain `__kpi5_snapshot__`).
 * Returns null if no snapshot has been computed yet; the card then
 * renders a "compute now" pendingReason instead of pretending to know.
 */
async function fetchKPI5FromSupabase(): Promise<{
  gapPercent: number
  meanOverlap: number
  generatedAt: string
  queriesAnalyzed: number
} | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  const { data, error } = await supabase
    .from('analyses')
    .select('summary, created_at, keywords')
    .eq('domain', '__kpi5_snapshot__')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const s: any = data[0].summary
  if (typeof s?.gapPercent !== 'number') return null

  return {
    gapPercent: s.gapPercent,
    meanOverlap: s.meanOverlap ?? 0,
    generatedAt: data[0].created_at,
    queriesAnalyzed: Array.isArray(data[0].keywords) ? data[0].keywords.length : 0,
  }
}

/**
 * KPI 4 — Sentiment Score. Reads the latest snapshot written by the
 * /api/cron/sentiment endpoint (sentinel domain `__sentiment_snapshot__`).
 * Returns null if no snapshot has been classified yet.
 */
async function fetchKPI4FromSentimentSnapshot(): Promise<{
  meanScore: number
  totalMentions: number
  byType: { recommended: number; mentioned: number; 'source-only': number; negative: number }
  generatedAt: string
} | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  const { data, error } = await supabase
    .from('analyses')
    .select('summary, created_at')
    .eq('domain', '__sentiment_snapshot__')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const s: any = data[0].summary
  if (typeof s?.meanScore !== 'number') return null

  return {
    meanScore: s.meanScore,
    totalMentions: s.totalMentions ?? 0,
    byType: s.byType ?? { recommended: 0, mentioned: 0, 'source-only': 0, negative: 0 },
    generatedAt: data[0].created_at,
  }
}

/**
 * KPI 3 — Citation Share %.
 *
 * Two data sources, in priority order:
 *   1. Latest monthly-25 KPI 5 snapshot (canonical 25 prompts, 5 clusters)
 *      — preferred because the prompt set is stable week-over-week and
 *      carries per-cluster aggregates needed for the dashboard breakdown.
 *   2. Latest matomo-crawl analysis (fallback when no monthly run yet)
 *      — keyword set varies per run, so directional signal only.
 *
 * Per-engine slice shows each engine's citation rate independently when
 * source #2 is used; for source #1 we instead surface per-cluster slices
 * via the byCluster field.
 */
async function fetchKPI3FromCanonicalSnapshot(): Promise<{
  citationShare: number // 0..100
  byCluster: Record<string, { name: string; citationShare: number; cited: number; total: number }>
  generatedAt: string
  promptCount: number
} | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  // monthly-25 only; weekly-5 has too small a denominator for KPI 3
  const { data, error } = await supabase
    .from('analyses')
    .select('summary, created_at, keywords')
    .eq('domain', '__kpi5_snapshot__')
    .eq('summary->>snapshotType', 'monthly-25')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const s: any = data[0].summary
  if (typeof s?.brandCitationShare !== 'number' || !s?.byCluster) return null

  // Lazy-import cluster names so we don't bloat module load.
  const { PROMPT_CLUSTERS } = await import('@/lib/prompts')
  const clusterNameById = new Map(PROMPT_CLUSTERS.map((c) => [c.id, c.name]))

  const byCluster: Record<string, { name: string; citationShare: number; cited: number; total: number }> = {}
  for (const [id, agg] of Object.entries(s.byCluster as Record<string, any>)) {
    byCluster[id] = {
      name: clusterNameById.get(id) ?? id,
      citationShare: Math.round((agg.citationShare ?? 0) * 1000) / 10, // → percent
      cited: agg.citedCount ?? 0,
      total: agg.promptCount ?? 0,
    }
  }

  return {
    citationShare: Math.round(s.brandCitationShare * 1000) / 10, // → percent
    byCluster,
    generatedAt: data[0].created_at,
    promptCount: s.totalKeywords ?? Array.isArray(data[0].keywords) ? data[0].keywords.length : 0,
  }
}

/**
 * KPI 3 — Citation Share %. Reads the most recent ProGrowth analysis from
 * Supabase and computes the percentage of tracked keywords where any AI
 * engine cited the domain. Per-engine breakdown is the per-engine citation
 * rate (e.g., ChatGPT cited 3 of 7 keywords → 43%).
 *
 * Used as a fallback when no monthly-25 canonical snapshot exists yet.
 */
async function fetchKPI3FromSupabase(): Promise<{
  citationShare: number
  perEngine: KPIPerEngineSlice[]
  analysisDate: string
} | null> {
  // Dynamic import so the scorecard module doesn't break in environments
  // without Supabase env vars (e.g., local without .env.local loaded).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  const { data, error } = await supabase
    .from('analyses')
    .select('summary, created_at')
    .or('domain.eq.progrowth.services,domain.eq.www.progrowth.services')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const s: any = data[0].summary
  const total: number = s?.totalKeywords ?? 0
  if (!total) return null

  const engineCounts: Array<[string, number]> = [
    ['Google AI Overview', s.googlePresent ?? 0],
    ['ChatGPT', s.chatgptPresent ?? 0],
    ['Perplexity', s.perplexityPresent ?? 0],
    ['Claude', s.claudePresent ?? 0],
  ]
  const totalCitations = engineCounts.reduce((sum, [, c]) => sum + c, 0)
  const citationShare = (totalCitations / (total * engineCounts.length)) * 100

  const perEngine = engineCounts
    .map(([engine, count]) => ({
      engine,
      visits: Math.round((count / total) * 100),
    }))
    .sort((a, b) => b.visits - a.visits)

  return {
    citationShare: Math.round(citationShare * 10) / 10,
    perEngine,
    analysisDate: data[0].created_at,
  }
}

function computeStatus(
  current: number | null,
  baseline: number,
  target30d: number | string,
  pending: boolean
): KPIStatus {
  if (pending || current === null) return 'pending'
  if (typeof target30d !== 'number') return 'on-track'
  // Linear interpolation: at day 30 we expect target; on day N we expect
  // baseline + (target - baseline) * (N / 30). With current = day 0 we just
  // compare to baseline.
  if (current >= target30d) return 'ahead'
  if (current >= baseline) return 'on-track'
  return 'behind'
}

/**
 * Fetch everything needed for a single Matomo-backed KPI in parallel —
 * current period total + per-engine, previous-period total for delta %,
 * and weekly time series for sparkline.
 */
async function fetchMatomoKPI(dimensionValue: string): Promise<{
  total: number | null
  perEngine: KPIPerEngineSlice[]
  previousPeriod: number | null
  weeklySeries: KPIWeeklyPoint[]
  error?: string
}> {
  const ranges = getDateRanges()
  try {
    const [main, previous, weekly] = await Promise.all([
      matomoCustomDimension(dimensionValue, 'range', 'last30'),
      matomoVisitCountForRange(dimensionValue, ranges.previous),
      matomoWeeklySeries(dimensionValue, 4),
    ])
    return {
      total: main.total,
      perEngine: main.perEngine,
      previousPeriod: previous,
      weeklySeries: weekly,
    }
  } catch (err) {
    return {
      total: null,
      perEngine: [],
      previousPeriod: null,
      weeklySeries: [],
      error: (err as Error).message,
    }
  }
}

export async function fetchKPIScorecard(): Promise<KPICard[]> {
  const cards: KPICard[] = []

  // KPI 1 — AI Crawler Visits
  const crawler = await fetchMatomoKPI('AI Crawler')
  cards.push({
    id: 1,
    name: 'AI Crawler Visits',
    question: 'Are AI tools reading our content?',
    funnelStage: 'Indexing — top of funnel',
    current: crawler.total,
    baseline: 918,
    target30d: 1100,
    target90d: 1800,
    unit: 'visits / 30 days',
    status: computeStatus(crawler.total, 918, 1100, crawler.error !== undefined),
    perEngine: crawler.perEngine,
    previousPeriod: crawler.previousPeriod,
    weeklySeries: crawler.weeklySeries,
    source: 'Matomo Custom Dimension 2 = "AI Crawler"',
    warningThreshold: '-30% WoW without explainable cause',
    pendingReason: crawler.error ? `Matomo fetch failed: ${crawler.error}` : undefined,
  })

  // KPI 2 — AI Referral Visits
  const referral = await fetchMatomoKPI('AI Referral')
  cards.push({
    id: 2,
    name: 'AI Referral Visits',
    question: 'Are humans clicking through from AI answers?',
    funnelStage: 'Outcome — bottom of funnel',
    current: referral.total,
    baseline: 1,
    target30d: 5,
    target90d: 40,
    unit: 'visits / 30 days',
    status: computeStatus(referral.total, 1, 5, referral.error !== undefined),
    perEngine: referral.perEngine,
    previousPeriod: referral.previousPeriod,
    weeklySeries: referral.weeklySeries,
    source: 'Matomo Custom Dimension 2 = "AI Referral"',
    warningThreshold: 'Zero referrals across 14 consecutive days',
    pendingReason: referral.error ? `Matomo fetch failed: ${referral.error}` : undefined,
  })

  // KPI 3 — Citation Share Across Tracked Prompts
  // Prefer the canonical monthly-25 snapshot (stable, cluster-tagged).
  // Fall back to the latest matomo-crawl analysis when no monthly run yet.
  const kpi3Canonical = await fetchKPI3FromCanonicalSnapshot()
  const kpi3Fallback = kpi3Canonical ? null : await fetchKPI3FromSupabase()

  if (kpi3Canonical) {
    // Convert byCluster to perEngine-shaped slices so the dashboard
    // component renders them uniformly. Each "engine" here is actually
    // a cluster — labels make this clear.
    const clusterSlices = Object.values(kpi3Canonical.byCluster).map((c) => ({
      engine: `${c.name} (${c.cited}/${c.total})`,
      visits: c.citationShare,
    }))
    cards.push({
      id: 3,
      name: 'Citation Share %',
      question: 'Of the 25 canonical prompts, how many cite ProGrowth?',
      funnelStage: 'Surface — middle of funnel',
      current: kpi3Canonical.citationShare,
      baseline: 0,
      target30d: 8,
      target90d: 25,
      unit: '% of 25 canonical prompts citing progrowth.services',
      status: computeStatus(kpi3Canonical.citationShare, 0, 8, false),
      perEngine: clusterSlices,
      perEngineUnit: 'percent',
      source: `Canonical 25-prompt monthly snapshot · ${new Date(kpi3Canonical.generatedAt).toLocaleDateString()}`,
      caveat:
        'Cluster slices show citation share per topical area. Monthly cadence — weekly 5-prompt probes update KPI 5 but do not refresh KPI 3.',
      warningThreshold: 'Drop on any cluster for 2 consecutive months',
    })
  } else if (kpi3Fallback) {
    cards.push({
      id: 3,
      name: 'Citation Share %',
      question: 'Of the prompts where we should appear, how often do we?',
      funnelStage: 'Surface — middle of funnel',
      current: kpi3Fallback.citationShare,
      baseline: 0,
      target30d: 8,
      target90d: 25,
      unit: '% prompts cited (avg across 4 engines)',
      status: computeStatus(kpi3Fallback.citationShare, 0, 8, false),
      perEngine: kpi3Fallback.perEngine,
      perEngineUnit: 'percent',
      source: `Latest ad-hoc analysis · ${new Date(kpi3Fallback.analysisDate).toLocaleDateString()}`,
      caveat:
        'Fallback source — keyword set varies per analysis. Run a monthly canonical snapshot for stable measurement (curl …/api/cron/geo-seo-gap?mode=monthly).',
      warningThreshold: 'Drop on any engine for 2 consecutive weeks',
    })
  } else {
    cards.push({
      id: 3,
      name: 'Citation Share %',
      question: 'Of the 25 canonical prompts, how many cite ProGrowth?',
      funnelStage: 'Surface — middle of funnel',
      current: null,
      baseline: 0,
      target30d: 8,
      target90d: 25,
      unit: '% of 25 canonical prompts citing progrowth.services',
      status: 'pending',
      source: 'Canonical 25-prompt monthly snapshot',
      pendingReason:
        'No canonical snapshot yet. Run `curl -H "Authorization: Bearer $CRON_SECRET" https://aioverviews.progrowth.services/api/cron/geo-seo-gap?mode=monthly` to take the first one (~$10, ~60s).',
      warningThreshold: 'Drop on any cluster for 2 consecutive months',
    })
  }

  // KPI 4 — Sentiment-Weighted Citation Score (Task 19).
  // Reads the latest snapshot persisted by /api/cron/sentiment. Score is
  // the mean of per-mention scores: recommended=+1, mentioned=+0.25,
  // source-only=0, negative=-1.
  const kpi4 = await fetchKPI4FromSentimentSnapshot()
  cards.push({
    id: 4,
    name: 'Sentiment Score',
    question: 'When mentioned, is it recommended, named, or just a hidden source?',
    funnelStage: 'Quality dimension',
    current: kpi4 ? kpi4.meanScore : null,
    baseline: 0,
    target30d: '>0.5',
    target90d: '>0.7',
    unit: 'avg score per mention (-1 to +1)',
    perEngine: kpi4
      ? [
          { engine: `Recommended (${kpi4.byType.recommended})`, visits: kpi4.byType.recommended },
          { engine: `Mentioned (${kpi4.byType.mentioned})`, visits: kpi4.byType.mentioned },
          { engine: `Source-only (${kpi4.byType['source-only']})`, visits: kpi4.byType['source-only'] },
          { engine: `Negative (${kpi4.byType.negative})`, visits: kpi4.byType.negative },
        ]
      : undefined,
    status: kpi4 ? computeStatus(kpi4.meanScore, 0, 0.5, false) : 'pending',
    source: kpi4
      ? `aioverviews sentiment classifier · ${kpi4.totalMentions} mentions · ${new Date(kpi4.generatedAt).toLocaleString()}`
      : 'aioverviews sentiment classifier',
    caveat: kpi4
      ? 'Mean score weights: recommended +1, mentioned +0.25, source-only 0, negative −1.'
      : undefined,
    pendingReason: kpi4
      ? undefined
      : 'No sentiment snapshot yet. Run `curl -H "Authorization: Bearer $BATCH_API_KEY" https://aioverviews.progrowth.services/api/cron/sentiment` after a citation network snapshot exists (~$0.10/mention).',
    warningThreshold: 'Any negative mention triggers immediate manual review',
  })

  // KPI 5 — GEO/SEO Gap
  // Reads the latest snapshot written by /api/cron/geo-seo-gap. If no
  // snapshot exists yet, the card tells the user how to compute one.
  const kpi5 = await fetchKPI5FromSupabase()
  cards.push({
    id: 5,
    name: 'GEO/SEO Gap',
    question: 'Is our Google rank translating to AI visibility?',
    funnelStage: 'Competitive diagnosis',
    current: kpi5 ? kpi5.gapPercent : null,
    baseline: 0,
    target30d: 'baseline measured',
    target90d: '<50%',
    unit: '% gap (lower = more SEO→GEO overlap)',
    status: kpi5 ? 'on-track' : 'pending',
    source: kpi5
      ? `DataForSEO Google SERP ∩ ChatGPT mention search · ${kpi5.queriesAnalyzed} probe queries · ${new Date(kpi5.generatedAt).toLocaleString()}`
      : 'DataForSEO Google SERP ∩ ChatGPT mention search — snapshot via /api/cron/geo-seo-gap',
    caveat: kpi5
      ? 'Snapshot is point-in-time — runs against 5 hardcoded probe queries today; Task 22 expands to the full prompt set.'
      : undefined,
    pendingReason: kpi5
      ? undefined
      : 'No snapshot stored yet. Run `curl -H "Authorization: Bearer $BATCH_API_KEY" https://aioverviews.progrowth.services/api/cron/geo-seo-gap` to populate (~$1 in DataForSEO credits, ~30s runtime).',
    warningThreshold: 'Gap widens for 3 consecutive weeks despite content shipping',
  })

  return cards
}
