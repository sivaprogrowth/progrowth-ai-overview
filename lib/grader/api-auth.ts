/**
 * Optional server-to-server Bearer authentication for the ProElevate
 * integration boundary (grader-api Task 2/3).
 *
 * DESIGN — additive, never replacing the existing public flow:
 * components/grader/GraderForm.tsx and ReportView.tsx call
 * POST /api/grader/analyze and GET /api/grader/report/[id] directly from
 * the browser, with NO Authorization header, and must keep working
 * unmodified — a browser can never safely hold PROELEVATE_API_KEY. So:
 *
 *   - no Authorization header at all   → 'unauthenticated'. The route
 *     proceeds exactly as it does today for a public visitor, still
 *     governed by the existing rate limit / duplicate-submission guard /
 *     spend guard (all untouched by this file).
 *   - an Authorization header IS present but isn't a valid
 *     `Bearer <PROELEVATE_API_KEY>` → 'invalid'. This is someone actively
 *     attempting (and failing) to authenticate, not the public flow — the
 *     route rejects it with 401 before doing any further work.
 *   - a valid `Bearer <PROELEVATE_API_KEY>` → 'authenticated'. The route
 *     proceeds exactly as it would for the public path; the API contract
 *     (lib/grader/types.ts's GraderReport shape, response codes) is
 *     unchanged either way — this only adds an accepted alternative
 *     credential, not a second code path.
 *
 * Missing vs. wrong token are intentionally indistinguishable to the
 * caller (both simply fail to authenticate) — never leak which case
 * occurred. A missing/unconfigured PROELEVATE_API_KEY on the server fails
 * closed: no presented token can ever be treated as valid when the server
 * itself has none configured, and this alone never breaks the public site
 * (which never presents a token to begin with, so it never reaches that
 * check). The key is never logged and never appears in any response.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

const BEARER_RE = /^Bearer\s+(.+)$/i

export type ApiAuthStatus = 'authenticated' | 'unauthenticated' | 'invalid'

/**
 * Fixed-length digest compare. Two reasons this isn't a direct
 * `timingSafeEqual(Buffer.from(a), Buffer.from(b))`: (1) that throws on a
 * length mismatch rather than returning false, and (2) even a length
 * check before it would leak the expected key's length via timing.
 * Hashing both sides first makes the comparison fixed-length regardless
 * of either input's length, closing both gaps.
 */
function safeTokenEquals(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** Pure status check — no Response construction, trivial to unit test. */
export function checkProelevateAuth(headers: Headers): ApiAuthStatus {
  const authHeader = headers.get('authorization')
  if (!authHeader) return 'unauthenticated'

  const match = authHeader.match(BEARER_RE)
  if (!match) return 'invalid'

  const provided = match[1].trim()
  if (!provided) return 'invalid'

  // Read only on the server; never NEXT_PUBLIC_-prefixed, so it's never
  // bundled into client JS regardless of where this function is imported.
  const expected = process.env.PROELEVATE_API_KEY
  if (!expected) return 'invalid' // integration not configured on this deployment — fail closed

  return safeTokenEquals(provided, expected) ? 'authenticated' : 'invalid'
}

/**
 * Route-handler guard. Returns a 401 NextResponse to return immediately
 * when a caller actively presented bad credentials; returns `null` when
 * the route should proceed — either genuinely authenticated, or via the
 * existing unauthenticated public path (whose own guards remain the
 * security boundary for that case, unchanged by this file).
 *
 * Deliberately the ONLY place that builds the 401 response, so every
 * protected route returns byte-identical, information-free failures
 * rather than each route re-deriving its own wording.
 */
export function requireValidProelevateAuthOrPublic(headers: Headers): NextResponse | null {
  if (checkProelevateAuth(headers) === 'invalid') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}
