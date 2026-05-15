import { NextRequest, NextResponse } from 'next/server'
import { classifyAllBrandMentions } from '@/lib/sentiment'
import { getClientFromRequest } from '@/lib/clientContext'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/sentiment
 *
 * Classifies every brand appearance from the resolved client's latest
 * citation network snapshot into one of 4 GEO-meaningful buckets:
 * recommended, mentioned, source-only, negative. Stores the result under
 * sentinel domain `__sentiment_snapshot__` (scoped by `client_id`).
 *
 * Multi-tenant: client comes from ?client=<slug>, the client_slug cookie,
 * or the default ('progrowth'). Auth handled by middleware.
 *
 * Cost: roughly $0.10 per mention (one engine re-query + one classifier
 * call). Linear in brand visibility — costs nothing when invisible.
 */
export async function GET(req: NextRequest) {
  const client = await getClientFromRequest(req)
  const summary = await classifyAllBrandMentions(client)
  return NextResponse.json({
    ...summary,
    client: { id: client.id, slug: client.slug },
  })
}
