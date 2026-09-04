import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkGraderDailyBudget,
  getGraderDailyRunLimit,
  startOfUtcDayIso,
  BUDGET_EXHAUSTED_MESSAGE,
} from '../../lib/grader/spend-guard'

test('getGraderDailyRunLimit defaults to 300 when unset', () => {
  delete process.env.GRADER_DAILY_RUN_LIMIT
  assert.equal(getGraderDailyRunLimit(), 300)
})

test('getGraderDailyRunLimit reads a configured positive integer', () => {
  process.env.GRADER_DAILY_RUN_LIMIT = '50'
  assert.equal(getGraderDailyRunLimit(), 50)
  delete process.env.GRADER_DAILY_RUN_LIMIT
})

test('getGraderDailyRunLimit falls back to the default on garbage input', () => {
  process.env.GRADER_DAILY_RUN_LIMIT = 'not-a-number'
  assert.equal(getGraderDailyRunLimit(), 300)
  process.env.GRADER_DAILY_RUN_LIMIT = '-5'
  assert.equal(getGraderDailyRunLimit(), 300)
  process.env.GRADER_DAILY_RUN_LIMIT = '0'
  assert.equal(getGraderDailyRunLimit(), 300)
  delete process.env.GRADER_DAILY_RUN_LIMIT
})

test('startOfUtcDayIso returns midnight UTC for the given date', () => {
  const iso = startOfUtcDayIso(new Date('2026-08-27T15:42:10.000Z'))
  assert.equal(iso, '2026-08-27T00:00:00.000Z')
})

test('checkGraderDailyBudget allows when under the limit', async () => {
  process.env.GRADER_DAILY_RUN_LIMIT = '10'
  const result = await checkGraderDailyBudget(async () => 5)
  assert.equal(result.allowed, true)
  assert.equal(result.limit, 10)
  assert.equal(result.runsToday, 5)
  delete process.env.GRADER_DAILY_RUN_LIMIT
})

test('checkGraderDailyBudget blocks when at or over the limit', async () => {
  process.env.GRADER_DAILY_RUN_LIMIT = '10'
  const atLimit = await checkGraderDailyBudget(async () => 10)
  assert.equal(atLimit.allowed, false)
  const overLimit = await checkGraderDailyBudget(async () => 15)
  assert.equal(overLimit.allowed, false)
  delete process.env.GRADER_DAILY_RUN_LIMIT
})

test('checkGraderDailyBudget passes the UTC-day boundary to the counter', async () => {
  let receivedSince: string | null = null
  const now = new Date('2026-08-27T23:59:00.000Z')
  await checkGraderDailyBudget(async (since) => {
    receivedSince = since
    return 0
  }, now)
  assert.equal(receivedSince, '2026-08-27T00:00:00.000Z')
})

test('BUDGET_EXHAUSTED_MESSAGE never mentions a number or a dollar sign', () => {
  assert.ok(!/\d/.test(BUDGET_EXHAUSTED_MESSAGE))
  assert.ok(!BUDGET_EXHAUSTED_MESSAGE.includes('$'))
})
