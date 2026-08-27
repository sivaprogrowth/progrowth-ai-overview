import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categorizeFailure } from '../../lib/grader/error-category'

test('categorizeFailure returns unknown for null/empty input', () => {
  assert.equal(categorizeFailure(null), 'unknown')
  assert.equal(categorizeFailure(undefined), 'unknown')
  assert.equal(categorizeFailure(''), 'unknown')
})

test('categorizeFailure recognizes budget/cap exhaustion', () => {
  assert.equal(categorizeFailure('daily analysis budget reached'), 'budget_exceeded')
  assert.equal(categorizeFailure('DataForSEO daily cost cap reached ($5/$50)'), 'budget_exceeded')
})

test('categorizeFailure recognizes access denied / auth issues', () => {
  assert.equal(categorizeFailure('Access denied. Visit Plans and Subscriptions'), 'access_denied')
  assert.equal(categorizeFailure('DataForSEO credentials not configured'), 'auth')
})

test('categorizeFailure recognizes timeouts', () => {
  assert.equal(categorizeFailure('analysis deadline reached before this call completed'), 'timeout')
  assert.equal(categorizeFailure('The operation timed out'), 'timeout')
})

test('categorizeFailure recognizes invalid/unparseable provider responses', () => {
  assert.equal(categorizeFailure('provider returned an empty answer'), 'invalid_response')
  assert.equal(categorizeFailure('Invalid Field: user_prompt'), 'invalid_response')
})

test('categorizeFailure recognizes provider-side failures', () => {
  assert.equal(categorizeFailure('DataForSEO /x/y failed (500): oops'), 'provider_unavailable')
  assert.equal(categorizeFailure('fetch failed'), 'provider_unavailable')
})

test('categorizeFailure falls back to unknown for an unrecognized message', () => {
  assert.equal(categorizeFailure('something completely different happened'), 'unknown')
})
