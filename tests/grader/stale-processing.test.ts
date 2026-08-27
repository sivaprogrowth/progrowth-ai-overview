import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStaleProcessingRun, withStaleProcessingRecovery, STALE_PROCESSING_THRESHOLD_MS } from '../../lib/grader/stale-processing'
import type { GraderRun } from '../../lib/grader/types'

function run(overrides: Partial<GraderRun>): GraderRun {
  return {
    reportId: '11111111-1111-1111-1111-111111111111',
    status: 'processing',
    report: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  }
}

test('isStaleProcessingRun is false for a non-processing run regardless of age', () => {
  const ancient = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS * 10).toISOString()
  assert.equal(isStaleProcessingRun(run({ status: 'completed', createdAt: ancient })), false)
})

test('isStaleProcessingRun is false for a fresh processing run', () => {
  assert.equal(isStaleProcessingRun(run({ createdAt: new Date().toISOString() })), false)
})

test('isStaleProcessingRun is true once past the threshold', () => {
  const now = Date.now()
  const stale = new Date(now - STALE_PROCESSING_THRESHOLD_MS - 1000).toISOString()
  assert.equal(isStaleProcessingRun(run({ createdAt: stale }), now), true)
})

test('isStaleProcessingRun is false exactly at the boundary (not yet over)', () => {
  const now = Date.now()
  const atBoundary = new Date(now - STALE_PROCESSING_THRESHOLD_MS).toISOString()
  assert.equal(isStaleProcessingRun(run({ createdAt: atBoundary }), now), false)
})

test('isStaleProcessingRun fails safe (false) on an unparseable createdAt', () => {
  assert.equal(isStaleProcessingRun(run({ createdAt: 'not-a-date' })), false)
})

test('withStaleProcessingRecovery converts a stale row to failed with no report', () => {
  const now = Date.now()
  const stale = run({ createdAt: new Date(now - STALE_PROCESSING_THRESHOLD_MS - 1).toISOString() })
  const recovered = withStaleProcessingRecovery(stale, now)
  assert.equal(recovered.status, 'failed')
  assert.equal(recovered.report, null)
  assert.ok(recovered.error)
})

test('withStaleProcessingRecovery passes through a fresh processing run unchanged', () => {
  const fresh = run({ createdAt: new Date().toISOString() })
  const result = withStaleProcessingRecovery(fresh)
  assert.deepEqual(result, fresh)
})

test('withStaleProcessingRecovery passes through a completed run unchanged', () => {
  const completed = run({ status: 'completed', createdAt: new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS * 5).toISOString() })
  const result = withStaleProcessingRecovery(completed)
  assert.deepEqual(result, completed)
})
