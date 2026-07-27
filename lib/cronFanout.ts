/**
 * Shared per-client cron fan-out (multi-tenant Phase 2).
 *
 * Keeps the Hobby 2-Vercel-cron cap: a single scheduled cron hits a route
 * with NO ?client=, which fans out — one fire-and-forget self-fetch per
 * `cron_enabled` client with ?client=<slug> — instead of needing N Vercel
 * cron entries. Mirrors the pattern proven in /api/cron/ai-readiness (26.4).
 *
 * Auth: self-fetches forward `Bearer ${CRON_SECRET}` when configured,
 * otherwise the incoming Authorization header (so a manual
 * `Bearer BATCH_API_KEY` trigger also fans out). Original query params are
 * preserved so ?mode=monthly / ?engines=… propagate to every child.
 *
 * Origin: children target resolvePublicOrigin(), NOT req.nextUrl.origin —
 * Vercel cron hits the SSO-protected deployment host and self-fetching it
 * 302s every child before middleware runs. See lib/publicOrigin.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { listActiveClients } from './clients'
import { resolvePublicOrigin } from './publicOrigin'

/** True when the request targets no specific client → should fan out. */
export function shouldFanOut(req: NextRequest): boolean {
  return !req.nextUrl.searchParams.get('client')
}

/**
 * Generic value fan-out: dispatch one self-fetch per `values[i]`, setting
 * `?{param}={value}` (parent params preserved, auth forwarded, run in
 * parallel as separate Vercel invocations). Used by citation-network to
 * split a client into 5 cluster-scoped sub-runs — a single full run 504s
 * past the 60s function cap, but each cluster (~5 prompts) finishes well
 * under it and the fetcher merges the latest snapshot per cluster.
 */
export async function fanOutValues(
  req: NextRequest,
  path: string,
  param: string,
  values: string[]
): Promise<NextResponse> {
  const origin = resolvePublicOrigin(req)
  const cronSecret = process.env.CRON_SECRET
  const auth = cronSecret ? `Bearer ${cronSecret}` : req.headers.get('authorization')

  const dispatched = await Promise.allSettled(
    values.map((value) => {
      const url = new URL(`${origin}${path}`)
      req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))
      url.searchParams.set(param, value)
      return fetch(url.toString(), {
        headers: auth ? { Authorization: auth } : {},
        signal: AbortSignal.timeout(55_000),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
    })
  )

  return NextResponse.json({
    mode: `fan-out:${param}`,
    [param]: values,
    dispatched: dispatched.map((d, i) =>
      d.status === 'fulfilled'
        ? { value: values[i], ok: d.value.status < 400, status: d.value.status }
        : { value: values[i], ok: false, error: String(d.reason) }
    ),
  })
}

export async function fanOutToClients(
  req: NextRequest,
  path: string,
  opts: { extraParams?: Record<string, string> } = {}
): Promise<NextResponse> {
  const clients = (await listActiveClients()).filter((c) => c.cron_enabled)
  const origin = resolvePublicOrigin(req)
  const cronSecret = process.env.CRON_SECRET
  const auth = cronSecret ? `Bearer ${cronSecret}` : req.headers.get('authorization')

  if (clients.length === 0) {
    return NextResponse.json({ mode: 'fan-out', cronEnabledClients: [], dispatched: [] })
  }

  const dispatched = await Promise.allSettled(
    clients.map((c) => {
      const url = new URL(`${origin}${path}`)
      // Preserve the parent's params (mode/engines/clusters/…) …
      req.nextUrl.searchParams.forEach((v, k) => url.searchParams.set(k, v))
      // … then pin this child to the client + any caller overrides.
      url.searchParams.set('client', c.slug)
      for (const [k, v] of Object.entries(opts.extraParams ?? {})) {
        url.searchParams.set(k, v)
      }
      return fetch(url.toString(), {
        headers: auth ? { Authorization: auth } : {},
        signal: AbortSignal.timeout(55_000),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
    })
  )

  return NextResponse.json({
    mode: 'fan-out',
    cronEnabledClients: clients.map((c) => c.slug),
    dispatched: dispatched.map((d, i) =>
      d.status === 'fulfilled'
        ? { slug: clients[i].slug, ok: d.value.status < 400, status: d.value.status }
        : { slug: clients[i].slug, ok: false, error: String(d.reason) }
    ),
  })
}
