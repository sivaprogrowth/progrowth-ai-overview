import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getGraderQueryCount, MIN_QUERIES, MAX_QUERIES } from '../../lib/grader/query-count'

test('getGraderQueryCount defaults to 8 when unset', () => {
  delete process.env.GRADER_QUERY_COUNT
  assert.equal(getGraderQueryCount(), 8)
})

test('getGraderQueryCount reads a configured value within bounds', () => {
  process.env.GRADER_QUERY_COUNT = '10'
  assert.equal(getGraderQueryCount(), 10)
  process.env.GRADER_QUERY_COUNT = '12'
  assert.equal(getGraderQueryCount(), 12)
  delete process.env.GRADER_QUERY_COUNT
})

test('getGraderQueryCount falls back to the default on garbage input', () => {
  for (const bad of ['not-a-number', '3.5', '', '   ']) {
    process.env.GRADER_QUERY_COUNT = bad
    assert.equal(getGraderQueryCount(), 8, `expected default for ${JSON.stringify(bad)}`)
  }
  delete process.env.GRADER_QUERY_COUNT
})

test('getGraderQueryCount clamps below MIN_QUERIES up to the floor', () => {
  process.env.GRADER_QUERY_COUNT = '1'
  assert.equal(getGraderQueryCount(), MIN_QUERIES)
  process.env.GRADER_QUERY_COUNT = '0'
  assert.equal(getGraderQueryCount(), MIN_QUERIES)
  process.env.GRADER_QUERY_COUNT = '-5'
  assert.equal(getGraderQueryCount(), MIN_QUERIES)
  delete process.env.GRADER_QUERY_COUNT
})

test('getGraderQueryCount clamps above MAX_QUERIES down to the ceiling', () => {
  process.env.GRADER_QUERY_COUNT = '100'
  assert.equal(getGraderQueryCount(), MAX_QUERIES)
  delete process.env.GRADER_QUERY_COUNT
})

test('getGraderQueryCount accepts the exact bounds', () => {
  process.env.GRADER_QUERY_COUNT = String(MIN_QUERIES)
  assert.equal(getGraderQueryCount(), MIN_QUERIES)
  process.env.GRADER_QUERY_COUNT = String(MAX_QUERIES)
  assert.equal(getGraderQueryCount(), MAX_QUERIES)
  delete process.env.GRADER_QUERY_COUNT
})
