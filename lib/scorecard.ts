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
  /** Visits in the immediately preceding 30-day window (for delta %) */
  previousPeriod?: number | null
  /** Most recent 4 weekly snapshots (oldest first) for sparkline */
  weeklySeries?: KPIWeeklyPoint[]
  source: string
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

  // KPI 3 — Citation Share Across Tracked Prompts (Task 16 dependency)
  cards.push({
    id: 3,
    name: 'Citation Share %',
    question: 'Of the prompts where we should appear, how often do we?',
    funnelStage: 'Surface — middle of funnel',
    current: null,
    baseline: 0,
    target30d: 8,
    target90d: 25,
    unit: '% prompts cited',
    status: 'pending',
    source: 'aioverviews weekly cron over 25 tracked prompts (5 clusters × 5 prompts)',
    pendingReason: 'Awaiting Task 16 — prompt cluster framework defined + weekly cron wired',
    warningThreshold: 'Drop on any engine for 2 consecutive weeks',
  })

  // KPI 4 — Sentiment-Weighted Citation Score (Task 19 dependency)
  cards.push({
    id: 4,
    name: 'Sentiment Score',
    question: 'When mentioned, is it positive, neutral, or damaging?',
    funnelStage: 'Quality dimension',
    current: null,
    baseline: 0,
    target30d: '>0.5',
    target90d: '>0.7',
    unit: 'avg score per mention (-1 to +1)',
    status: 'pending',
    source: 'aioverviews + GPT-4o-mini sentiment classifier',
    pendingReason: 'Awaiting Task 19 — sentiment classification shipped to aioverviews',
    warningThreshold: 'Any negative mention triggers immediate manual review',
  })

  // KPI 5 — GEO/SEO Gap (Task 22 + DataForSEO wiring)
  cards.push({
    id: 5,
    name: 'GEO/SEO Gap',
    question: 'Is our Google rank translating to AI visibility?',
    funnelStage: 'Competitive diagnosis',
    current: null,
    baseline: 0,
    target30d: 'baseline measured',
    target90d: '<50%',
    unit: '% domain overlap (AI ∩ Google top-10)',
    status: 'pending',
    source: 'aioverviews citations ∩ DataForSEO Google top-10 for same query',
    pendingReason: 'Awaiting Task 22 + GEO/SEO gap query implementation',
    warningThreshold: 'Gap widens for 3 consecutive weeks despite content shipping',
  })

  return cards
}
