import { NextRequest, NextResponse } from 'next/server'
import {
  computeKpi5GeoSeoGap,
  getPromptsForMode,
  resolveRunMode,
  type RunMode,
} from '@/lib/geoSeoGap'
import { sendScorecardDigest } from '@/lib/scorecardDigest'
import { getClientFromRequest } from '@/lib/clientContext'
import { fanOutToClients, shouldFanOut } from '@/lib/cronFanout'
import type { Client } from '@/lib/clients'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function isVercelCron(req: NextRequest): boolean {
  return req.headers.get('x-vercel-cron') === '1' || req.nextUrl.searchParams.get('email') === 'true'
}

/**
 * GET /api/cron/geo-seo-gap
 *
 * Multi-tenant: scopes everything to the resolved client. The client comes
 * from ?client=<slug>, the client_slug cookie, or the default ('progrowth')
 * — see lib/clientContext.
 *
 * Query params:
 *   ?client=<slug>      pick which tenant to analyse
 *   ?queries=a,b,c      custom ad-hoc set
 *   ?mode=weekly        force 5-prompt probe
 *   ?mode=monthly       force 25-prompt canonical run (~$10)
 *   ?mode=auto          monthly on first Monday of month, weekly otherwise
 *   ?email=true         force-send the digest even outside a Vercel cron call
 *
 * Multi-tenant fan-out: called WITHOUT ?client= (the scheduled Vercel
 * cron), it fans out to every cron_enabled client — one self-fetch each
 * with ?client=<slug> — keeping the Hobby 2-cron cap. ?email=true is
 * forwarded so each client still gets its weekly digest on the cron run.
 *
 * COST: ~$1.00 per invocation (5 queries) or ~$10 monthly (25). The
 * checkDailyCap() guard in lib/dataforseo.ts refuses if the daily cap
 * is exceeded.
 */
export async function GET(req: NextRequest) {
  if (shouldFanOut(req)) {
    const extraParams = isVercelCron(req) ? { email: 'true' } : undefined
    return fanOutToClients(req, '/api/cron/geo-seo-gap', { extraParams })
  }
  const client = await getClientFromRequest(req)
  return runForClient(client, req)
}

async function runForClient(client: Client, req: NextRequest): Promise<NextResponse> {
  const qsQueries = req.nextUrl.searchParams.get('queries')
  const modeParam = (req.nextUrl.searchParams.get('mode') as RunMode | null) ?? 'auto'
  const mode = resolveRunMode(modeParam)
  const queries = qsQueries
    ? qsQueries.split(',').map((q) => q.trim()).filter(Boolean)
    : getPromptsForMode(mode, client)

  const result = await computeKpi5GeoSeoGap(client, queries, mode)

  const snapshotType = mode === 'monthly' ? 'monthly-25' : 'weekly-5'
  const { error } = await supabase.from('analyses').insert({
    email: client.notification_email ?? 'system@progrowth.services',
    domain: '__kpi5_snapshot__',
    client_id: client.id,
    keywords: queries,
    summary: {
      source: 'kpi5-geo-seo-gap',
      snapshotType,
      mode,
      gapPercent: result.gapPercent,
      meanOverlap: result.meanOverlap,
      brandCitationShare: result.brandCitationShare,
      byCluster: result.byCluster,
      totalKeywords: queries.length,
    },
    rows: result.queries.map((q) => ({
      keyword: q.query,
      promptId: q.promptId,
      cluster: q.cluster,
      promptType: q.promptType,
      overlap: q.overlap,
      brandCitedByChatgpt: q.brandCitedByChatgpt,
      brandRankedByGoogle: q.brandRankedByGoogle,
      chatgptDomainCount: q.chatgptDomains.length,
      googleDomainCount: q.googleDomains.length,
      sharedDomains: q.chatgptDomains.filter((d) =>
        q.googleDomains.map((g) => g.toLowerCase()).includes(d.toLowerCase())
      ),
    })),
  })

  let digest = null
  if (isVercelCron(req)) {
    digest = await sendScorecardDigest(client)
  }

  return NextResponse.json({
    ...result,
    client: { id: client.id, slug: client.slug },
    stored: !error,
    storeError: error?.message ?? null,
    digest,
  })
}
