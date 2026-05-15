import { NextRequest, NextResponse } from 'next/server'
import { fetchKPIScorecard } from '@/lib/scorecard'
import { getClientFromRequest } from '@/lib/clientContext'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'

/**
 * GET /api/matomo/kpi
 *
 * Returns the Matomo-backed GEO KPIs (KPI 1: AI Crawler Visits, KPI 2: AI
 * Referral Visits) as JSON. Auth is handled by middleware.ts — pass either:
 *   Authorization: Bearer <BATCH_API_KEY>      ← for external scripts
 *   Authorization: Bearer <CRON_SECRET>        ← for the scheduled cron
 *   Cookie: session=<jwt>                       ← when called from the app UI
 *
 * Query params:
 *   ?format=flat  → returns flat key/value pairs ready for Sheets ingestion
 *                   (default is `nested`, matching the in-app /api/scorecard)
 *
 * Used by:
 *   • /scorecard page (via /api/scorecard which calls the same data layer)
 *   • Google Apps Script weekly puller into the GEO scorecard sheet
 *   • Future cron job at /api/cron/scorecard-snapshot
 */
export async function GET(req: NextRequest) {
  const client = await getClientFromRequest(req)
  const cards = await fetchKPIScorecard(client)
  // Return any KPI that has live data. Pending cards (data not yet wired)
  // are excluded so the external consumer only sees actionable rows.
  // Today this is KPIs 1, 2, 3. KPIs 4 + 5 join automatically once their
  // tasks ship and the lib/scorecard.ts loaders return non-null.
  const measurable = cards.filter((c) => c.current !== null)

  const format = req.nextUrl.searchParams.get('format') ?? 'nested'

  if (format === 'flat') {
    // Sheet-friendly key/value pairs. One row per KPI.
    const rows = measurable.map((c) => ({
      kpi_id: c.id,
      kpi_name: c.name,
      current: c.current,
      previous_period: c.previousPeriod ?? null,
      delta_percent:
        c.current !== null && c.previousPeriod && c.previousPeriod > 0
          ? Math.round(((c.current - c.previousPeriod) / c.previousPeriod) * 100)
          : null,
      baseline: c.baseline,
      target_30d: c.target30d,
      target_90d: c.target90d,
      status: c.status,
      per_engine_json: JSON.stringify(c.perEngine ?? []),
      weekly_series_json: JSON.stringify(c.weeklySeries ?? []),
      generated_at: new Date().toISOString(),
    }))
    return NextResponse.json({ rows })
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    cards: measurable,
  })
}
