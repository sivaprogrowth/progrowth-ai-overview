/**
 * Grader query-count bounds + configured target (Phase 2 performance work).
 *
 * Dependency-free leaf — owns the MIN/MAX bounds so both this module and
 * lib/grader/query-generator.ts can read them without a circular import
 * (query-generator needs the configured target from here; this module
 * needs the bounds query-generator used to own). query-generator.ts
 * re-exports MIN_QUERIES/MAX_QUERIES unchanged, so nothing importing them
 * from there needs to change.
 *
 * The target is centralized so it can be dialed via ONE environment
 * variable rather than a code change — same pattern as
 * lib/grader/concurrency.ts's GRADER_PROVIDER_CONCURRENCY.
 *
 * Default is 8, not the historical 12 — the Phase 2 report (real, live
 * HubSpot data plus a real weaker-visibility company's data, both re-run
 * through the exact production scoring pipeline with no new provider
 * spend) found overall/category scores, competitor lists, citation
 * metrics, and recommendation sets all held essentially steady at 8, while
 * 10 produced a real, measurable dip for a company whose visibility is
 * concentrated in branded queries — an artifact of the template
 * generator's round-robin ordering, which splits queries evenly 2/2/2/2
 * across the four intent categories at 8 but unevenly 3/3/2/2 at 10 (it
 * skews toward the two high-priority categories AT THE EXPENSE of the two
 * medium-priority ones, which is exactly the wrong trade for a brand whose
 * real wins live there). See the Phase 2 report for the full before/after
 * numbers.
 */

/** Hard ceiling on generated queries — the public cost/latency bound. */
export const MAX_QUERIES = 12
/** Below this the report is not worth producing. */
export const MIN_QUERIES = 8

const DEFAULT_QUERY_COUNT = 8

/**
 * Reads `GRADER_QUERY_COUNT`. Falls back to the default (8) when unset,
 * non-numeric, or non-integer; clamps into [MIN_QUERIES, MAX_QUERIES]
 * rather than rejecting the run.
 */
export function getGraderQueryCount(): number {
  const raw = process.env.GRADER_QUERY_COUNT
  if (!raw) return DEFAULT_QUERY_COUNT

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return DEFAULT_QUERY_COUNT
  return Math.max(MIN_QUERIES, Math.min(MAX_QUERIES, parsed))
}
