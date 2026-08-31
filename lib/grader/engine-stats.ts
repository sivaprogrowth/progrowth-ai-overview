/**
 * Per-engine call timing/reliability aggregation — a dependency-free leaf,
 * split out of lib/grader/dataforseo.ts specifically so it can be unit
 * tested without pulling in that module's transitive import of the shared
 * lib/dataforseo.ts (which needs `@/lib/supabase` resolvable at runtime —
 * not something the plain `tsc -p tsconfig.test.json && node --test`
 * pipeline this repo uses can do; see tests/grader/engine-stats.test.ts).
 * Same separation-of-concerns principle as lib/grader/grade.ts's round1/
 * gradeFor: pure math kept apart from the module that does real I/O.
 *
 * Phase 1 performance work (§3 of the brief — "is ChatGPT slower than
 * Perplexity? Is Claude creating the tail latency?"). Server-side
 * diagnostics only: never attached to `EngineAnswer`, `GraderReport`, or
 * any persisted/public shape, so it can't leak into the public report API
 * however it's produced or consumed upstream.
 */

import type { EngineAnswer, GraderEngine } from './types'

export interface EngineCallStats {
  engine: GraderEngine
  attempted: number
  succeeded: number
  failed: number
  /** Fastest/slowest/average are computed only over calls that actually
   *  settled before the deadline — a call still in flight when the deadline
   *  fires has no real, known duration to report. */
  fastestMs: number | null
  slowestMs: number | null
  avgMs: number | null
  /** From this engine's first call start to its last call finish. */
  wallClockSpanMs: number | null
}

export interface CallTiming {
  engine: GraderEngine
  startedAt: number
  finishedAt: number
}

/**
 * Pure aggregation over already-collected per-call timings — no I/O, no
 * randomness, safe to unit test with synthetic data.
 */
export function summarizeEngineCallStats(
  pairs: Array<{ engine: GraderEngine }>,
  results: EngineAnswer[],
  timings: Array<CallTiming | undefined>,
  engines: GraderEngine[]
): EngineCallStats[] {
  return engines.map((engine) => {
    const indices = pairs.reduce<number[]>((acc, p, i) => (p.engine === engine ? [...acc, i] : acc), [])
    const attempted = indices.length
    const succeeded = indices.filter((i) => results[i]?.error === null).length
    const failed = attempted - succeeded

    const completed = indices.map((i) => timings[i]).filter((t): t is CallTiming => t !== undefined)
    const durations = completed.map((t) => t.finishedAt - t.startedAt)

    return {
      engine,
      attempted,
      succeeded,
      failed,
      fastestMs: durations.length > 0 ? Math.min(...durations) : null,
      slowestMs: durations.length > 0 ? Math.max(...durations) : null,
      avgMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      wallClockSpanMs:
        completed.length > 0
          ? Math.max(...completed.map((t) => t.finishedAt)) - Math.min(...completed.map((t) => t.startedAt))
          : null,
    }
  })
}
