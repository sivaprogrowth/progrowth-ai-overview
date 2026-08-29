import { redirect } from 'next/navigation'

/**
 * ProGrowth AI Grader is the public showcase entry point — a visitor
 * landing on `/` should reach it immediately, with no login shown and no
 * flash of internal content first.
 *
 * A server-side redirect (not a client-side check) is deliberate: it
 * happens before any HTML renders, so nothing in the internal product
 * (LoginForm, the analyzer dashboard, InternalChrome) is ever mounted for
 * a visitor hitting `/`. The internal product itself was NOT deleted or
 * gated further — it moved, verbatim, to /dashboard (see
 * app/dashboard/page.tsx), which internal staff can still visit directly
 * and which still does its own client-side auth check exactly as `/`
 * used to. middleware.ts is unchanged: page routes already passed through
 * regardless of session before this change (auth there has always been
 * client-side), so `/dashboard` is protected exactly the same way `/`
 * was.
 *
 * `dynamic = 'force-dynamic'` is required, not decorative: this page has
 * no dynamic data, so Next.js would otherwise statically prerender it —
 * and a `redirect()` inside a STATIC page doesn't emit a real HTTP 307
 * with a `Location` header at all. It bakes the redirect into the RSC
 * payload as a `NEXT_REDIRECT` digest that only the CLIENT-SIDE React
 * runtime acts on. That happens to work in a real browser (imperceptibly
 * fast client-side navigation) but produces zero `Location` header for
 * curl, bots, health checks, or any non-JS client — verified directly:
 * without this line, `curl -I /` returned 307 with NO Location header.
 * Forcing dynamic rendering makes `redirect()` behave as a normal
 * server-side redirect on every request, confirmed via the same curl
 * check afterward (`Location: /grader` present).
 */
export const dynamic = 'force-dynamic'

export default function RootPage() {
  redirect('/grader')
}
