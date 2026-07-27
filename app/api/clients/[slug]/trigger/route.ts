import { NextRequest, NextResponse } from 'next/server'
import { getClientBySlug } from '@/lib/clients'
import { resolvePublicOrigin } from '@/lib/publicOrigin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// A full citation-network run fans out per-cluster (each child < 60s); the
// parent awaits all children, so allow this proxy the same window.
export const maxDuration = 60

/**
 * POST /api/clients/[slug]/trigger   body: { job: string }
 *
 * Session-authenticated, in-app trigger for the per-client analyses that are
 * otherwise only reachable via `curl -H 'Authorization: Bearer $BATCH_API_KEY'
 * /api/cron/<job>?client=<slug>`. Lets logged-in staff populate a brand-new
 * client's snapshots from the UI (the empty states / scorecard buttons)
 * without handling the batch key by hand.
 *
 * Auth: gated by middleware — /api/clients/* is NOT in the Bearer allowlist,
 * so only a valid `session` cookie reaches this handler. The handler then
 * server-side self-fetches the matching /api/cron/<job> route with the
 * server-held BATCH_API_KEY (which the middleware allowlist accepts), reusing
 * the existing compute + per-cluster fan-out instead of duplicating it.
 *
 * Each run costs real API credits (citation-network ~$8), so this is an
 * explicit, on-demand action — never auto-fired.
 */
const ALLOWED_JOBS = new Set([
  'citation-network',
  'sentiment',
  'geo-seo-gap',
  'ai-readiness',
  'matomo-analysis',
])

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const client = await getClientBySlug(slug)
  if (!client) {
    return NextResponse.json({ error: `Client "${slug}" not found` }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  const job = String((body as { job?: unknown } | null)?.job ?? '')
  if (!ALLOWED_JOBS.has(job)) {
    return NextResponse.json(
      { error: `Unsupported job "${job}". Expected one of: ${[...ALLOWED_JOBS].join(', ')}` },
      { status: 400 }
    )
  }

  const apiKey = process.env.BATCH_API_KEY || process.env.CRON_SECRET
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Server is missing BATCH_API_KEY / CRON_SECRET — cannot trigger analyses.' },
      { status: 500 }
    )
  }

  // Pin ?client=<slug> so the cron resolves THIS tenant (not the cookie/default).
  // Public origin, not the request origin: triggering from a *.vercel.app
  // deployment URL would self-fetch an SSO-protected host and 302.
  const url = new URL(`${resolvePublicOrigin(req)}/api/cron/${job}`)
  url.searchParams.set('client', client.slug)

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      // Stay just inside maxDuration so we return a clean "still running"
      // instead of a hard 504 if the run overruns the function window.
      signal: AbortSignal.timeout(58_000),
    })
    const result = await res.json().catch(() => null)
    if (!res.ok) {
      return NextResponse.json(
        { error: `Analysis run failed (HTTP ${res.status}).`, result },
        { status: 502 }
      )
    }
    return NextResponse.json({ ok: true, job, client: client.slug, result })
  } catch (err: unknown) {
    const name = (err as { name?: string })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      // The fan-out usually finishes within the budget; if it overran, the
      // sub-runs are still completing — the snapshot appears on refresh.
      return NextResponse.json(
        {
          ok: true,
          pending: true,
          job,
          client: client.slug,
          message: 'Analysis is still running — refresh in a couple of minutes.',
        },
        { status: 202 }
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Failed to trigger analysis: ${message}` },
      { status: 500 }
    )
  }
}
