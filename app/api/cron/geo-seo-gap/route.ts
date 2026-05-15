import { NextRequest, NextResponse } from 'next/server'
import { computeKpi5GeoSeoGap, GEO_SEO_PROBE_QUERIES } from '@/lib/geoSeoGap'
import { sendScorecardDigest } from '@/lib/scorecardDigest'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Detect whether this request was triggered by Vercel's cron scheduler vs a
 * manual curl. Vercel adds an `x-vercel-cron` header on scheduled runs. We
 * use this so manual diagnostic hits don't spam the inbox with digest mail.
 */
function isVercelCron(req: NextRequest): boolean {
  return req.headers.get('x-vercel-cron') === '1' || req.nextUrl.searchParams.get('email') === 'true'
}

/**
 * GET /api/cron/geo-seo-gap
 *
 * Runs the KPI 5 GEO/SEO Gap measurement against DataForSEO and stores the
 * result for the dashboard to read.
 *
 * Auth handled by middleware (/api/cron/* accepts Bearer BATCH_API_KEY or
 * CRON_SECRET, plus session cookies). Designed to be invoked:
 *   • Manually via curl when you want a fresh measurement
 *   • By a Vercel cron schedule (configure in vercel.json) — subtask 20.6
 *   • By the dashboard's "Compute now" button if/when added
 *
 * COST: ~$1.00 per invocation (5 queries × ~$0.20 each in DataForSEO
 * credits). Not cheap — don't wire to page-load. The existing
 * checkDailyCap() guard in lib/dataforseo.ts will refuse if the daily
 * spending cap is exceeded.
 *
 * Persistence: writes a row to the `analyses` table with a sentinel domain
 * `__kpi5_snapshot__` so the scorecard's KPI 5 fetcher can find it. Avoids
 * needing a separate kpi_snapshots table; trades schema cleanliness for
 * zero-migration deployment.
 */
export async function GET(req: NextRequest) {
  const qsQueries = req.nextUrl.searchParams.get('queries')
  const queries = qsQueries ? qsQueries.split(',').map((q) => q.trim()).filter(Boolean) : GEO_SEO_PROBE_QUERIES

  const result = await computeKpi5GeoSeoGap(queries)

  // Persist as a sentinel analysis row so /api/scorecard can read the latest
  // snapshot without us standing up a new table.
  const { error } = await supabase.from('analyses').insert({
    email: 'system@progrowth.services',
    domain: '__kpi5_snapshot__',
    keywords: queries,
    summary: {
      source: 'kpi5-geo-seo-gap',
      gapPercent: result.gapPercent,
      meanOverlap: result.meanOverlap,
      totalKeywords: queries.length,
    },
    rows: result.queries.map((q) => ({
      keyword: q.query,
      overlap: q.overlap,
      chatgptDomainCount: q.chatgptDomains.length,
      googleDomainCount: q.googleDomains.length,
      sharedDomains: q.chatgptDomains.filter((d) =>
        q.googleDomains.map((g) => g.toLowerCase()).includes(d.toLowerCase())
      ),
    })),
  })

  // If invoked by Vercel's scheduler (or with ?email=true for manual test),
  // send the weekly digest email AFTER the snapshot is persisted so the
  // digest reads the freshly-stored KPI 5 value.
  let digest = null
  if (isVercelCron(req)) {
    digest = await sendScorecardDigest()
  }

  return NextResponse.json({
    ...result,
    stored: !error,
    storeError: error?.message ?? null,
    digest,
  })
}
