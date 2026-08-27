/**
 * Sanitized failure categorization for structured logging (Phase 3,
 * Task 16, Task 25). Maps a raw error message (which may legitimately
 * contain provider response text server-side) to one of a small, stable
 * set of categories — safe to put in log lines, dashboards, or alerts
 * without ever needing the raw text to leave the server.
 *
 * Pure string matching, deliberately conservative: an unmatched message
 * falls into 'unknown' rather than a guessed specific category.
 */

export type FailureCategory =
  | 'auth'
  | 'access_denied'
  | 'rate_limited'
  | 'budget_exceeded'
  | 'timeout'
  | 'provider_unavailable'
  | 'invalid_response'
  | 'unknown'

const PATTERNS: Array<[FailureCategory, RegExp]> = [
  ['auth', /credentials not configured|unauthorized|401/i],
  ['access_denied', /access denied|40204|forbidden|403/i],
  ['budget_exceeded', /daily.*cap|budget|cap exceeded/i],
  ['rate_limited', /rate limit|429|too many requests/i],
  ['timeout', /timeout|timed out|deadline/i],
  ['invalid_response', /empty answer|no parseable|unparseable|invalid field|40501/i],
  ['provider_unavailable', /failed \(5\d\d\)|internal error|50000|unavailable|fetch failed/i],
]

export function categorizeFailure(message: string | null | undefined): FailureCategory {
  if (!message) return 'unknown'
  for (const [category, pattern] of PATTERNS) {
    if (pattern.test(message)) return category
  }
  return 'unknown'
}
