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
  source: string
  pendingReason?: string
  warningThreshold?: string
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

export async function fetchKPIScorecard(): Promise<KPICard[]> {
  const cards: KPICard[] = []

  // KPI 1 — AI Crawler Visits
  try {
    const { total, perEngine } = await matomoCustomDimension('AI Crawler')
    cards.push({
      id: 1,
      name: 'AI Crawler Visits',
      question: 'Are AI tools reading our content?',
      funnelStage: 'Indexing — top of funnel',
      current: total,
      baseline: 918,
      target30d: 1100,
      target90d: 1800,
      unit: 'visits / 30 days',
      status: computeStatus(total, 918, 1100, false),
      perEngine,
      source: 'Matomo Custom Dimension 2 = "AI Crawler"',
      warningThreshold: '-30% WoW without explainable cause',
    })
  } catch (err) {
    cards.push({
      id: 1,
      name: 'AI Crawler Visits',
      question: 'Are AI tools reading our content?',
      funnelStage: 'Indexing — top of funnel',
      current: null,
      baseline: 918,
      target30d: 1100,
      target90d: 1800,
      unit: 'visits / 30 days',
      status: 'pending',
      source: 'Matomo Custom Dimension 2 = "AI Crawler"',
      pendingReason: `Matomo fetch failed: ${(err as Error).message}`,
    })
  }

  // KPI 2 — AI Referral Visits
  try {
    const { total, perEngine } = await matomoCustomDimension('AI Referral')
    cards.push({
      id: 2,
      name: 'AI Referral Visits',
      question: 'Are humans clicking through from AI answers?',
      funnelStage: 'Outcome — bottom of funnel',
      current: total,
      baseline: 1,
      target30d: 5,
      target90d: 40,
      unit: 'visits / 30 days',
      status: computeStatus(total, 1, 5, false),
      perEngine,
      source: 'Matomo Custom Dimension 2 = "AI Referral"',
      warningThreshold: 'Zero referrals across 14 consecutive days',
    })
  } catch (err) {
    cards.push({
      id: 2,
      name: 'AI Referral Visits',
      question: 'Are humans clicking through from AI answers?',
      funnelStage: 'Outcome — bottom of funnel',
      current: null,
      baseline: 1,
      target30d: 5,
      target90d: 40,
      unit: 'visits / 30 days',
      status: 'pending',
      source: 'Matomo Custom Dimension 2 = "AI Referral"',
      pendingReason: `Matomo fetch failed: ${(err as Error).message}`,
    })
  }

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
