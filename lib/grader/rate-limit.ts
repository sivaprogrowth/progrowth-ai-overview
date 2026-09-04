/**
 * Best-effort per-IP rate limiting for the public grader endpoint, plus a
 * same-(client,domain) duplicate-submission guard below.
 *
 * HONEST LIMITATION: this is an in-process token bucket. Vercel serverless
 * functions are stateless between cold starts and run as multiple
 * concurrent instances, so this only throttles bursts an individual warm
 * instance happens to see — it is NOT a durable, cross-instance limit.
 *
 * PHASE 3 DECISION (Task 9): kept as-is for the Sunday launch rather than
 * adding Redis/Upstash. Launch traffic is expected to be low/controlled,
 * and a shared store is real new infrastructure this phase's "harden,
 * don't rearchitect" rule argues against introducing without evidence
 * it's needed. The two guards actually enforced server-side today are:
 * per-IP request rate (this file) and the grader-specific daily run cap
 * (lib/grader/spend-guard.ts) — the latter IS durable (backed by a
 * Supabase count, not memory), so the worst case of this file's weakness
 * (an attacker spread across many cold starts) is still bounded by that
 * cap. Revisit if launch traffic proves this insufficient.
 */

interface Bucket {
  count: number
  windowStart: number
}

const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 5

const buckets = new Map<string, Bucket>()

/** Bound memory: an unbounded Map on a long-lived warm instance is its own DoS vector. */
const MAX_TRACKED_IPS = 5_000

export function isRateLimited(key: string, now = Date.now()): boolean {
  const existing = buckets.get(key)
  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    if (!existing && buckets.size >= MAX_TRACKED_IPS) {
      // Evict the oldest-looking entry rather than grow unbounded.
      const firstKey = buckets.keys().next().value
      if (firstKey !== undefined) buckets.delete(firstKey)
    }
    buckets.set(key, { count: 1, windowStart: now })
    return false
  }
  existing.count += 1
  return existing.count > MAX_PER_WINDOW
}

/** Best-effort client identifier from standard proxy headers, else 'unknown'. */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return headers.get('x-real-ip') ?? 'unknown'
}

/**
 * Duplicate-submission guard (Phase 3, Task 14): the SAME client
 * submitting the SAME normalized domain again within a short window is
 * almost certainly a double-click, a page refresh, or a resubmitted form
 * — not a genuine second request — and would otherwise trigger a second
 * full paid analysis. Deliberately not the general rate limiter above:
 * this only blocks an exact (client, domain) repeat, so a client running
 * several *different* domains back-to-back is unaffected.
 *
 * Same in-memory, per-instance caveat as isRateLimited above — this is a
 * UX nicety against accidental double-submits, not a security boundary
 * (a determined caller can always vary the domain slightly, or wait out
 * the window, or hit a different warm instance).
 */
const DUPLICATE_WINDOW_MS = 20_000
const recentSubmissions = new Map<string, number>()
const MAX_TRACKED_SUBMISSIONS = 5_000

export function isDuplicateSubmission(clientKey: string, normalizedDomain: string, now = Date.now()): boolean {
  const key = `${clientKey}::${normalizedDomain}`
  const last = recentSubmissions.get(key)
  if (last !== undefined && now - last < DUPLICATE_WINDOW_MS) {
    return true
  }
  if (!last && recentSubmissions.size >= MAX_TRACKED_SUBMISSIONS) {
    const firstKey = recentSubmissions.keys().next().value
    if (firstKey !== undefined) recentSubmissions.delete(firstKey)
  }
  recentSubmissions.set(key, now)
  return false
}
