import { NextRequest, NextResponse } from 'next/server'
import { classifyAllProgrowthMentions } from '@/lib/sentiment'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/sentiment
 *
 * Classifies every ProGrowth appearance from the latest citation network
 * snapshot into one of 4 GEO-meaningful buckets: recommended, mentioned,
 * source-only, negative. Stores the result under sentinel domain
 * `__sentiment_snapshot__` so KPI 4 and the citation-network UI can read
 * it back.
 *
 * Auth handled by middleware (/api/cron/* accepts Bearer BATCH_API_KEY or
 * CRON_SECRET, plus session cookies).
 *
 * Cost: roughly $0.10 per mention (one engine re-query + one gpt-4o-mini
 * classifier call). Linear in brand visibility, which is the right cost
 * model — costs nothing when we're invisible, grows naturally as
 * citations grow.
 *
 * Re-run cadence: after each citation network refresh (quarterly), and
 * on demand when investigating a specific cell. Not a Vercel cron — the
 * input snapshot is itself stable for ~quarter.
 */
export async function GET(_req: NextRequest) {
  const summary = await classifyAllProgrowthMentions()
  return NextResponse.json(summary)
}
