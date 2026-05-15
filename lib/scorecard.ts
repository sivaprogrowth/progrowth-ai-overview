/**
 * GEO KPI Scorecard data layer (multi-tenant Phase 1).
 *
 * Five KPIs defined in /Users/sivam1mac/ProGrowth_GEO_KPI_Scorecard.md.
 * Every fetch is scoped to a Client. The client's Matomo config + KPI
 * baselines drive thresholds and per-engine breakdowns; missing config
 * (e.g. no matomo_site_id) renders KPI 1/2 as pending instead of failing.
 *
 *   KPI 1  AI Crawler Visits     — Matomo CD2 = "AI Crawler"
 *   KPI 2  AI Referral Visits    — Matomo CD2 = "AI Referral"
 *   KPI 3  Citation Share %      — depends on Task 16 (prompt clusters)
 *   KPI 4  Sentiment Score       — depends on Task 19 (sentiment classifier)
 *   KPI 5  GEO/SEO Gap %         — depends on Task 22 (citation network) wired
 *                                   with DataForSEO comparison
 */

import { type Client, getBrandDomainSet } from './clients'
import { getClustersForClient } from './prompts'

const AI_TRAFFIC_TYPE_DIMENSION = '2'

export type KPIStatus = 'on-track' | 'behind' | 'ahead' | 'pending'

export interface KPIPerEngineSlice {
  engine: string
  visits: number
}

export interface KPIWeeklyPoint {
  weekLabel: string
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
  perEngineUnit?: 'visits' | 'percent'
  previousPeriod?: number | null
  weeklySeries?: KPIWeeklyPoint[]
  source: string
  caveat?: string
  pendingReason?: string
  warningThreshold?: string
}

interface MatomoConfig {
  url: string
  siteId: string
  tokenAuth: string
}

function resolveMatomoConfig(client: Client): MatomoConfig | null {
  const url = client.matomo_url || process.env.MATOMO_URL || ''
  const siteId = client.matomo_site_id || ''
  const tokenAuth = process.env.MATOMO_TOKEN_AUTH || ''
  if (!url || !siteId || !tokenAuth) return null
  return { url, siteId, tokenAuth }
}

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
  cfg: MatomoConfig,
  dimensionValue: string,
  period: string = 'range',
  date: string = 'last30'
): Promise<{ total: number; perEngine: KPIPerEngineSlice[] }> {
  const url = new URL(`${cfg.url}/index.php`)
  url.searchParams.set('module', 'API')
  url.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  url.searchParams.set('idSite', cfg.siteId)
  url.searchParams.set('idDimension', AI_TRAFFIC_TYPE_DIMENSION)
  url.searchParams.set('period', period)
  url.searchParams.set('date', date)
  url.searchParams.set('token_auth', cfg.tokenAuth)
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

  const perEngineUrl = new URL(`${cfg.url}/index.php`)
  perEngineUrl.searchParams.set('module', 'API')
  perEngineUrl.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  perEngineUrl.searchParams.set('idSite', cfg.siteId)
  perEngineUrl.searchParams.set('idDimension', '1')
  perEngineUrl.searchParams.set('period', period)
  perEngineUrl.searchParams.set('date', date)
  perEngineUrl.searchParams.set('token_auth', cfg.tokenAuth)
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

async function matomoVisitCountForRange(
  cfg: MatomoConfig,
  dimensionValue: string,
  dateRange: string
): Promise<number> {
  const url = new URL(`${cfg.url}/index.php`)
  url.searchParams.set('module', 'API')
  url.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  url.searchParams.set('idSite', cfg.siteId)
  url.searchParams.set('idDimension', AI_TRAFFIC_TYPE_DIMENSION)
  url.searchParams.set('period', 'range')
  url.searchParams.set('date', dateRange)
  url.searchParams.set('token_auth', cfg.tokenAuth)
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

async function matomoWeeklySeries(
  cfg: MatomoConfig,
  dimensionValue: string,
  weeks: number = 4
): Promise<KPIWeeklyPoint[]> {
  const url = new URL(`${cfg.url}/index.php`)
  url.searchParams.set('module', 'API')
  url.searchParams.set('method', 'CustomDimensions.getCustomDimension')
  url.searchParams.set('idSite', cfg.siteId)
  url.searchParams.set('idDimension', AI_TRAFFIC_TYPE_DIMENSION)
  url.searchParams.set('period', 'week')
  url.searchParams.set('date', `last${weeks}`)
  url.searchParams.set('token_auth', cfg.tokenAuth)
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

async function fetchKPI5FromSupabase(client: Client): Promise<{
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
    .eq('client_id', client.id)
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

async function fetchKPI4FromSentimentSnapshot(client: Client): Promise<{
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
    .eq('client_id', client.id)
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

async function fetchKPI3FromCanonicalSnapshot(client: Client): Promise<{
  citationShare: number
  byCluster: Record<string, { name: string; citationShare: number; cited: number; total: number }>
  generatedAt: string
  promptCount: number
} | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  const { data, error } = await supabase
    .from('analyses')
    .select('summary, created_at, keywords')
    .eq('client_id', client.id)
    .eq('domain', '__kpi5_snapshot__')
    .eq('summary->>snapshotType', 'monthly-25')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const s: any = data[0].summary
  if (typeof s?.brandCitationShare !== 'number' || !s?.byCluster) return null

  const clusters = getClustersForClient(client)
  const clusterNameById = new Map(clusters.map((c) => [c.id, c.name]))

  const byCluster: Record<string, { name: string; citationShare: number; cited: number; total: number }> = {}
  for (const [id, agg] of Object.entries(s.byCluster as Record<string, any>)) {
    byCluster[id] = {
      name: clusterNameById.get(id) ?? id,
      citationShare: Math.round((agg.citationShare ?? 0) * 1000) / 10,
      cited: agg.citedCount ?? 0,
      total: agg.promptCount ?? 0,
    }
  }

  return {
    citationShare: Math.round(s.brandCitationShare * 1000) / 10,
    byCluster,
    generatedAt: data[0].created_at,
    promptCount: s.totalKeywords ?? (Array.isArray(data[0].keywords) ? data[0].keywords.length : 0),
  }
}

/**
 * KPI 3 fallback — latest ad-hoc analysis the agency ran for this client's
 * domain via the homepage form. Used only when no monthly canonical
 * snapshot exists yet.
 */
async function fetchKPI3FromSupabase(client: Client): Promise<{
  citationShare: number
  perEngine: KPIPerEngineSlice[]
  analysisDate: string
} | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  const brandDomains = Array.from(getBrandDomainSet(client))
  // .in() against the full domain set covers both primary + alt domains
  const { data, error } = await supabase
    .from('analyses')
    .select('summary, created_at')
    .eq('client_id', client.id)
    .in('domain', brandDomains)
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
  if (current >= target30d) return 'ahead'
  if (current >= baseline) return 'on-track'
  return 'behind'
}

async function fetchMatomoKPI(
  cfg: MatomoConfig,
  dimensionValue: string
): Promise<{
  total: number | null
  perEngine: KPIPerEngineSlice[]
  previousPeriod: number | null
  weeklySeries: KPIWeeklyPoint[]
  error?: string
}> {
  const ranges = getDateRanges()
  try {
    const [main, previous, weekly] = await Promise.all([
      matomoCustomDimension(cfg, dimensionValue, 'range', 'last30'),
      matomoVisitCountForRange(cfg, dimensionValue, ranges.previous),
      matomoWeeklySeries(cfg, dimensionValue, 4),
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

/**
 * Read a KPI's baseline + targets from the client config, falling back
 * to sensible defaults. Lets every card take its thresholds from one
 * place (Supabase `clients.kpi_baselines`).
 */
function getBaselines(client: Client, kpiId: keyof typeof DEFAULT_BASELINES): {
  baseline: number
  target30d: number | string
  target90d: number | string
} {
  const raw = client.kpi_baselines[kpiId]
  if (raw) return raw
  return DEFAULT_BASELINES[kpiId]
}

const DEFAULT_BASELINES = {
  '1': { baseline: 0, target30d: 100, target90d: 500 },
  '2': { baseline: 0, target30d: 3, target90d: 20 },
  '3': { baseline: 0, target30d: 8, target90d: 25 },
  '4': { baseline: 0, target30d: '>0.5', target90d: '>0.7' },
  '5': { baseline: 0, target30d: 'baseline measured', target90d: '<50%' },
} as const

export async function fetchKPIScorecard(client: Client): Promise<KPICard[]> {
  const cards: KPICard[] = []
  const matomoCfg = resolveMatomoConfig(client)
  const matomoPendingReason = matomoCfg
    ? undefined
    : `Matomo not configured for ${client.company_name}. Add ${client.primary_domain} to your Matomo instance and set the site ID in clients.matomo_site_id.`

  // ── KPI 1 — AI Crawler Visits ─────────────────────────────────────────
  const k1 = getBaselines(client, '1')
  if (matomoCfg) {
    const crawler = await fetchMatomoKPI(matomoCfg, 'AI Crawler')
    const threshold30 = typeof k1.target30d === 'number' ? k1.target30d : 0
    cards.push({
      id: 1,
      name: 'AI Crawler Visits',
      question: 'Are AI tools reading our content?',
      funnelStage: 'Indexing — top of funnel',
      current: crawler.total,
      baseline: k1.baseline,
      target30d: k1.target30d,
      target90d: k1.target90d,
      unit: 'visits / 30 days',
      status: computeStatus(crawler.total, k1.baseline, threshold30, crawler.error !== undefined),
      perEngine: crawler.perEngine,
      previousPeriod: crawler.previousPeriod,
      weeklySeries: crawler.weeklySeries,
      source: 'Matomo Custom Dimension 2 = "AI Crawler"',
      warningThreshold: '-30% WoW without explainable cause',
      pendingReason: crawler.error ? `Matomo fetch failed: ${crawler.error}` : undefined,
    })
  } else {
    cards.push({
      id: 1,
      name: 'AI Crawler Visits',
      question: 'Are AI tools reading our content?',
      funnelStage: 'Indexing — top of funnel',
      current: null,
      baseline: k1.baseline,
      target30d: k1.target30d,
      target90d: k1.target90d,
      unit: 'visits / 30 days',
      status: 'pending',
      source: 'Matomo Custom Dimension 2 = "AI Crawler"',
      pendingReason: matomoPendingReason,
      warningThreshold: '-30% WoW without explainable cause',
    })
  }

  // ── KPI 2 — AI Referral Visits ────────────────────────────────────────
  const k2 = getBaselines(client, '2')
  if (matomoCfg) {
    const referral = await fetchMatomoKPI(matomoCfg, 'AI Referral')
    const threshold30 = typeof k2.target30d === 'number' ? k2.target30d : 0
    cards.push({
      id: 2,
      name: 'AI Referral Visits',
      question: 'Are humans clicking through from AI answers?',
      funnelStage: 'Outcome — bottom of funnel',
      current: referral.total,
      baseline: k2.baseline,
      target30d: k2.target30d,
      target90d: k2.target90d,
      unit: 'visits / 30 days',
      status: computeStatus(referral.total, k2.baseline, threshold30, referral.error !== undefined),
      perEngine: referral.perEngine,
      previousPeriod: referral.previousPeriod,
      weeklySeries: referral.weeklySeries,
      source: 'Matomo Custom Dimension 2 = "AI Referral"',
      warningThreshold: 'Zero referrals across 14 consecutive days',
      pendingReason: referral.error ? `Matomo fetch failed: ${referral.error}` : undefined,
    })
  } else {
    cards.push({
      id: 2,
      name: 'AI Referral Visits',
      question: 'Are humans clicking through from AI answers?',
      funnelStage: 'Outcome — bottom of funnel',
      current: null,
      baseline: k2.baseline,
      target30d: k2.target30d,
      target90d: k2.target90d,
      unit: 'visits / 30 days',
      status: 'pending',
      source: 'Matomo Custom Dimension 2 = "AI Referral"',
      pendingReason: matomoPendingReason,
      warningThreshold: 'Zero referrals across 14 consecutive days',
    })
  }

  // ── KPI 3 — Citation Share ────────────────────────────────────────────
  const k3 = getBaselines(client, '3')
  const k3Canonical = await fetchKPI3FromCanonicalSnapshot(client)
  const k3Fallback = k3Canonical ? null : await fetchKPI3FromSupabase(client)
  const promptCountForCopy = k3Canonical?.promptCount ?? 25

  if (k3Canonical) {
    const clusterSlices = Object.values(k3Canonical.byCluster).map((c) => ({
      engine: `${c.name} (${c.cited}/${c.total})`,
      visits: c.citationShare,
    }))
    cards.push({
      id: 3,
      name: 'Citation Share %',
      question: `Of the ${promptCountForCopy} canonical prompts, how many cite ${client.company_name}?`,
      funnelStage: 'Surface — middle of funnel',
      current: k3Canonical.citationShare,
      baseline: k3.baseline,
      target30d: k3.target30d,
      target90d: k3.target90d,
      unit: `% of canonical prompts citing ${client.primary_domain}`,
      status: computeStatus(k3Canonical.citationShare, k3.baseline, typeof k3.target30d === 'number' ? k3.target30d : 0, false),
      perEngine: clusterSlices,
      perEngineUnit: 'percent',
      source: `Canonical prompt monthly snapshot · ${new Date(k3Canonical.generatedAt).toLocaleDateString()}`,
      caveat:
        'Cluster slices show citation share per topical area. Monthly cadence — weekly probes update KPI 5 but do not refresh KPI 3.',
      warningThreshold: 'Drop on any cluster for 2 consecutive months',
    })
  } else if (k3Fallback) {
    cards.push({
      id: 3,
      name: 'Citation Share %',
      question: 'Of the prompts where we should appear, how often do we?',
      funnelStage: 'Surface — middle of funnel',
      current: k3Fallback.citationShare,
      baseline: k3.baseline,
      target30d: k3.target30d,
      target90d: k3.target90d,
      unit: '% prompts cited (avg across 4 engines)',
      status: computeStatus(k3Fallback.citationShare, k3.baseline, typeof k3.target30d === 'number' ? k3.target30d : 0, false),
      perEngine: k3Fallback.perEngine,
      perEngineUnit: 'percent',
      source: `Latest ad-hoc analysis · ${new Date(k3Fallback.analysisDate).toLocaleDateString()}`,
      caveat:
        'Fallback source — keyword set varies per analysis. Run a monthly canonical snapshot for stable measurement.',
      warningThreshold: 'Drop on any engine for 2 consecutive weeks',
    })
  } else {
    cards.push({
      id: 3,
      name: 'Citation Share %',
      question: `Of the canonical prompts, how many cite ${client.company_name}?`,
      funnelStage: 'Surface — middle of funnel',
      current: null,
      baseline: k3.baseline,
      target30d: k3.target30d,
      target90d: k3.target90d,
      unit: `% of canonical prompts citing ${client.primary_domain}`,
      status: 'pending',
      source: 'Canonical prompt monthly snapshot',
      pendingReason: `No canonical snapshot for ${client.company_name} yet. Run \`curl -H "Authorization: Bearer $CRON_SECRET" https://aioverviews.progrowth.services/api/cron/geo-seo-gap?client=${client.slug}&mode=monthly\` to take the first one (~$10, ~60s).`,
      warningThreshold: 'Drop on any cluster for 2 consecutive months',
    })
  }

  // ── KPI 4 — Sentiment-Weighted Citation Score ─────────────────────────
  const k4 = getBaselines(client, '4')
  const kpi4 = await fetchKPI4FromSentimentSnapshot(client)
  cards.push({
    id: 4,
    name: 'Sentiment Score',
    question: 'When mentioned, is it recommended, named, or just a hidden source?',
    funnelStage: 'Quality dimension',
    current: kpi4 ? kpi4.meanScore : null,
    baseline: k4.baseline,
    target30d: k4.target30d,
    target90d: k4.target90d,
    unit: 'avg score per mention (-1 to +1)',
    perEngine: kpi4
      ? [
          { engine: `Recommended (${kpi4.byType.recommended})`, visits: kpi4.byType.recommended },
          { engine: `Mentioned (${kpi4.byType.mentioned})`, visits: kpi4.byType.mentioned },
          { engine: `Source-only (${kpi4.byType['source-only']})`, visits: kpi4.byType['source-only'] },
          { engine: `Negative (${kpi4.byType.negative})`, visits: kpi4.byType.negative },
        ]
      : undefined,
    status: kpi4 ? computeStatus(kpi4.meanScore, k4.baseline, 0.5, false) : 'pending',
    source: kpi4
      ? `aioverviews sentiment classifier · ${kpi4.totalMentions} mentions · ${new Date(kpi4.generatedAt).toLocaleString()}`
      : 'aioverviews sentiment classifier',
    caveat: kpi4
      ? 'Mean score weights: recommended +1, mentioned +0.25, source-only 0, negative −1.'
      : undefined,
    pendingReason: kpi4
      ? undefined
      : `No sentiment snapshot yet. Run \`curl -H "Authorization: Bearer $BATCH_API_KEY" https://aioverviews.progrowth.services/api/cron/sentiment?client=${client.slug}\` after a citation network snapshot exists (~$0.10/mention).`,
    warningThreshold: 'Any negative mention triggers immediate manual review',
  })

  // ── KPI 5 — GEO/SEO Gap ───────────────────────────────────────────────
  const k5 = getBaselines(client, '5')
  const kpi5 = await fetchKPI5FromSupabase(client)
  cards.push({
    id: 5,
    name: 'GEO/SEO Gap',
    question: 'Is Google rank translating to AI visibility?',
    funnelStage: 'Competitive diagnosis',
    current: kpi5 ? kpi5.gapPercent : null,
    baseline: k5.baseline,
    target30d: k5.target30d,
    target90d: k5.target90d,
    unit: '% gap (lower = more SEO→GEO overlap)',
    status: kpi5 ? 'on-track' : 'pending',
    source: kpi5
      ? `DataForSEO Google SERP ∩ ChatGPT mention search · ${kpi5.queriesAnalyzed} probe queries · ${new Date(kpi5.generatedAt).toLocaleString()}`
      : 'DataForSEO Google SERP ∩ ChatGPT mention search — snapshot via /api/cron/geo-seo-gap',
    caveat: kpi5
      ? 'Snapshot is point-in-time. Weekly probe set runs ~5 queries; monthly full run covers the canonical 25.'
      : undefined,
    pendingReason: kpi5
      ? undefined
      : `No snapshot stored yet. Run \`curl -H "Authorization: Bearer $BATCH_API_KEY" https://aioverviews.progrowth.services/api/cron/geo-seo-gap?client=${client.slug}\` to populate (~$1 in DataForSEO credits, ~30s runtime).`,
    warningThreshold: 'Gap widens for 3 consecutive weeks despite content shipping',
  })

  return cards
}
