/**
 * Lightweight stage-timing instrumentation for the grader (Phase 1
 * performance work).
 *
 * Plain structured console logs, matching the `console.log('[tag] ...')`
 * convention this codebase already uses (see the `[grader/analyze]` lines
 * in app/api/grader/analyze/route.ts) — no new logging dependency, per the
 * Phase 1 instruction not to introduce one just for this.
 *
 * Never logs credentials or raw provider response bodies: callers pass a
 * stage name and a duration, nothing else. One line per stage:
 *   [grader:timing] reportId=<id> stage=<name> durationMs=<n>
 */

export function logGraderTiming(reportId: string, stage: string, durationMs: number): void {
  console.log(`[grader:timing] reportId=${reportId} stage=${stage} durationMs=${durationMs}`)
}

/**
 * Run and time an async stage. Logs its duration under `stage` whether it
 * resolves or throws (a failing stage's time is exactly the data a
 * bottleneck investigation needs), then re-throws/returns unchanged so
 * this never alters the wrapped stage's own success/failure behavior.
 */
export async function timedStage<T>(reportId: string, stage: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now()
  try {
    return await fn()
  } finally {
    logGraderTiming(reportId, stage, Date.now() - start)
  }
}

/** Same contract as `timedStage`, for the synchronous CPU-only steps. */
export function timedSyncStage<T>(reportId: string, stage: string, fn: () => T): T {
  const start = Date.now()
  try {
    return fn()
  } finally {
    logGraderTiming(reportId, stage, Date.now() - start)
  }
}
