import { test } from 'node:test'
import assert from 'node:assert/strict'
import { logGraderTiming, timedStage, timedSyncStage } from '../../lib/grader/timing'

/**
 * All assertions here check LOG SHAPE and CONTROL FLOW (does the wrapped
 * value/error pass through unchanged, is exactly one line logged), never a
 * real elapsed-time bound — a `durationMs < 50` style assertion would be
 * flaky by construction on a loaded CI box (Phase 1 Task 23: no timing-based
 * tests).
 */

function captureConsoleLog(): { calls: string[]; restore: () => void } {
  const calls: string[] = []
  const original = console.log
  console.log = (...args: unknown[]) => {
    calls.push(args.map(String).join(' '))
  }
  return { calls, restore: () => { console.log = original } }
}

test('logGraderTiming logs exactly one structured line with the given fields', () => {
  const { calls, restore } = captureConsoleLog()
  try {
    logGraderTiming('report-123', 'scoring', 42)
  } finally {
    restore()
  }
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^\[grader:timing\] reportId=report-123 stage=scoring durationMs=42$/)
})

test('timedStage returns the wrapped async function\'s resolved value unchanged', async () => {
  const { restore } = captureConsoleLog()
  const result = await timedStage('r1', 'stage-a', async () => ({ ok: true, value: 7 })).finally(restore)
  assert.deepEqual(result, { ok: true, value: 7 })
})

test('timedStage logs exactly one line for the stage it wraps', async () => {
  const { calls, restore } = captureConsoleLog()
  await timedStage('r2', 'stage-b', async () => 'done')
  restore()
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^\[grader:timing\] reportId=r2 stage=stage-b durationMs=\d+$/)
})

test('timedStage re-throws the wrapped function\'s error, still logging its duration', async () => {
  const { calls, restore } = captureConsoleLog()
  await assert.rejects(
    () => timedStage('r3', 'stage-c', async () => { throw new Error('boom') }),
    /boom/
  )
  restore()
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^\[grader:timing\] reportId=r3 stage=stage-c durationMs=\d+$/)
})

test('timedSyncStage returns the wrapped sync function\'s value unchanged', () => {
  const { restore } = captureConsoleLog()
  const result = timedSyncStage('r4', 'stage-d', () => 123)
  restore()
  assert.equal(result, 123)
})

test('timedSyncStage propagates a thrown error, still logging its duration', () => {
  const { calls, restore } = captureConsoleLog()
  assert.throws(() => timedSyncStage('r5', 'stage-e', () => { throw new Error('nope') }), /nope/)
  restore()
  assert.equal(calls.length, 1)
  assert.match(calls[0], /^\[grader:timing\] reportId=r5 stage=stage-e durationMs=\d+$/)
})
