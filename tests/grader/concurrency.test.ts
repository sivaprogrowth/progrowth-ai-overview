import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getGraderProviderConcurrency, GRADER_PROVIDER_CONCURRENCY_BOUNDS } from '../../lib/grader/concurrency'

test('getGraderProviderConcurrency defaults to 4 when unset', () => {
  delete process.env.GRADER_PROVIDER_CONCURRENCY
  assert.equal(getGraderProviderConcurrency(), 4)
  assert.equal(GRADER_PROVIDER_CONCURRENCY_BOUNDS.default, 4)
})

test('getGraderProviderConcurrency reads a configured value within bounds', () => {
  process.env.GRADER_PROVIDER_CONCURRENCY = '6'
  assert.equal(getGraderProviderConcurrency(), 6)
  process.env.GRADER_PROVIDER_CONCURRENCY = '8'
  assert.equal(getGraderProviderConcurrency(), 8)
  delete process.env.GRADER_PROVIDER_CONCURRENCY
})

test('getGraderProviderConcurrency falls back to the default on garbage input', () => {
  for (const bad of ['not-a-number', '-5', '0', '3.5', '', '   ']) {
    process.env.GRADER_PROVIDER_CONCURRENCY = bad
    assert.equal(getGraderProviderConcurrency(), 4, `expected default for ${JSON.stringify(bad)}`)
  }
  delete process.env.GRADER_PROVIDER_CONCURRENCY
})

test('getGraderProviderConcurrency clamps to the configured maximum rather than rejecting', () => {
  process.env.GRADER_PROVIDER_CONCURRENCY = '100'
  assert.equal(getGraderProviderConcurrency(), GRADER_PROVIDER_CONCURRENCY_BOUNDS.max)
  process.env.GRADER_PROVIDER_CONCURRENCY = String(GRADER_PROVIDER_CONCURRENCY_BOUNDS.max)
  assert.equal(getGraderProviderConcurrency(), GRADER_PROVIDER_CONCURRENCY_BOUNDS.max)
  delete process.env.GRADER_PROVIDER_CONCURRENCY
})

test('getGraderProviderConcurrency accepts the minimum', () => {
  process.env.GRADER_PROVIDER_CONCURRENCY = String(GRADER_PROVIDER_CONCURRENCY_BOUNDS.min)
  assert.equal(getGraderProviderConcurrency(), GRADER_PROVIDER_CONCURRENCY_BOUNDS.min)
  delete process.env.GRADER_PROVIDER_CONCURRENCY
})
