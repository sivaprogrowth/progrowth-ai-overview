/**
 * Best-effort per-IP rate limiting for the public grader endpoint.
 *
 * HONEST LIMITATION: this is an in-process token bucket. Vercel serverless
 * functions are stateless between cold starts and run as multiple
 * concurrent instances, so this only throttles bursts an individual warm
 * instance happens to see — it is NOT a durable, cross-instance limit.
 * Real production rate limiting (a shared store — Redis/Upstash, or an edge
 * WAF rule) is explicitly Phase 3 (see the Phase 1 "out of scope" list —
 * "advanced rate limiting"). This exists so Phase 1 is not wide open, not
 * as the final answer.
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
