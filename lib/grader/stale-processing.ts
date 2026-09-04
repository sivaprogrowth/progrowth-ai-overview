/**
 * Stale `processing` recovery (Phase 3, Task 13).
 *
 * POST /api/grader/analyze runs synchronously and always persists a
 * final status before returning (Phase 2) — so under normal operation no
 * row should ever stay at `processing` for more than the time one
 * request takes. The one way it still can: the platform kills the
 * function mid-flight (a deploy, an OOM, a hard timeout above what
 * ANSWER_DEADLINE_MS controls) before the `completeGraderRun` write runs.
 * That row is then stuck at `processing` forever with nothing left to
 * ever update it — there is no background worker in this architecture to
 * notice.
 *
 * Fix is a read-time transform, not a write, not a worker: if a row is
 * still `processing` well past how long a real run could plausibly take,
 * report retrieval treats it as failed instead of leaving the caller
 * polling forever. No row is mutated — a genuinely slow-but-alive request
 * (extremely unlikely given the 230s internal deadline, but not
 * impossible under platform cold-start jitter) is free to still complete
 * and overwrite the row normally; this only changes what a READ sees in
 * the meantime.
 */

import type { GraderRun } from './types'

/**
 * Generous relative to the ~230s internal analysis deadline (Task 12) —
 * wide enough that no legitimately-still-running request is ever
 * misreported, narrow enough that a genuinely abandoned row does not
 * poll forever. Centralized here rather than duplicated at each call site.
 */
export const STALE_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000 // 15 minutes

export function isStaleProcessingRun(run: Pick<GraderRun, 'status' | 'createdAt'>, now = Date.now()): boolean {
  if (run.status !== 'processing') return false
  const createdAtMs = Date.parse(run.createdAt)
  if (Number.isNaN(createdAtMs)) return false
  return now - createdAtMs > STALE_PROCESSING_THRESHOLD_MS
}

/**
 * Read-time transform: a stale `processing` run is reported as `failed`
 * with a retryable, honest message. Any other run passes through
 * unchanged.
 */
export function withStaleProcessingRecovery(run: GraderRun, now = Date.now()): GraderRun {
  if (!isStaleProcessingRun(run, now)) return run
  return {
    ...run,
    status: 'failed',
    report: null,
    error: 'This analysis took too long and did not complete. Please try running it again.',
  }
}
