/**
 * Grader-specific DataForSEO fan-out concurrency (Phase 1 performance work).
 *
 * Centralizes the value so a benchmark can be run by changing ONE
 * environment variable rather than editing lib/grader/analyzer.ts, and
 * validates it the same way lib/grader/spend-guard.ts validates
 * GRADER_DAILY_RUN_LIMIT: fail safe to the default on anything that isn't
 * a positive integer, and clamp to a hard ceiling so a misconfigured value
 * (e.g. GRADER_PROVIDER_CONCURRENCY=100) can never hammer DataForSEO.
 *
 * Default stays 4 — today's production behavior — until a benchmark
 * (see the Phase 1 performance report) justifies changing it.
 */

const DEFAULT_PROVIDER_CONCURRENCY = 4
const MIN_PROVIDER_CONCURRENCY = 1
const MAX_PROVIDER_CONCURRENCY = 12

export const GRADER_PROVIDER_CONCURRENCY_BOUNDS = {
  min: MIN_PROVIDER_CONCURRENCY,
  max: MAX_PROVIDER_CONCURRENCY,
  default: DEFAULT_PROVIDER_CONCURRENCY,
} as const

/**
 * Reads `GRADER_PROVIDER_CONCURRENCY`. Falls back to the default (4) when
 * unset, non-numeric, non-integer, or below the minimum; clamps anything
 * above the maximum down to it rather than rejecting the run.
 */
export function getGraderProviderConcurrency(): number {
  const raw = process.env.GRADER_PROVIDER_CONCURRENCY
  if (!raw) return DEFAULT_PROVIDER_CONCURRENCY

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < MIN_PROVIDER_CONCURRENCY) {
    return DEFAULT_PROVIDER_CONCURRENCY
  }
  return Math.min(parsed, MAX_PROVIDER_CONCURRENCY)
}
