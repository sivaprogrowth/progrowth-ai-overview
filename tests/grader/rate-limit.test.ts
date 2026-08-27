import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRateLimited, clientKeyFromHeaders, isDuplicateSubmission } from '../../lib/grader/rate-limit'

test('clientKeyFromHeaders prefers x-forwarded-for, first entry only', () => {
  const headers = new Headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })
  assert.equal(clientKeyFromHeaders(headers), '1.2.3.4')
})

test('clientKeyFromHeaders falls back to x-real-ip then unknown', () => {
  assert.equal(clientKeyFromHeaders(new Headers({ 'x-real-ip': '9.9.9.9' })), '9.9.9.9')
  assert.equal(clientKeyFromHeaders(new Headers()), 'unknown')
})

test('isRateLimited allows the first N requests in a window then blocks', () => {
  const key = `test-key-${Date.now()}-${Math.random()}`
  const now = Date.now()
  for (let i = 0; i < 5; i++) {
    assert.equal(isRateLimited(key, now), false, `request ${i + 1} should be allowed`)
  }
  assert.equal(isRateLimited(key, now), true)
})

test('isRateLimited resets after the window elapses', () => {
  const key = `test-key-window-${Date.now()}-${Math.random()}`
  const now = Date.now()
  for (let i = 0; i < 5; i++) isRateLimited(key, now)
  assert.equal(isRateLimited(key, now), true)
  assert.equal(isRateLimited(key, now + 60_001), false)
})

test('isDuplicateSubmission blocks an immediate repeat of the same client+domain', () => {
  const key = `dup-${Date.now()}-${Math.random()}`
  const now = Date.now()
  assert.equal(isDuplicateSubmission(key, 'example.com', now), false)
  assert.equal(isDuplicateSubmission(key, 'example.com', now + 1000), true)
})

test('isDuplicateSubmission allows a different domain from the same client immediately', () => {
  const key = `dup2-${Date.now()}-${Math.random()}`
  const now = Date.now()
  assert.equal(isDuplicateSubmission(key, 'example.com', now), false)
  assert.equal(isDuplicateSubmission(key, 'other.com', now + 100), false)
})

test('isDuplicateSubmission allows a repeat once the window elapses', () => {
  const key = `dup3-${Date.now()}-${Math.random()}`
  const now = Date.now()
  assert.equal(isDuplicateSubmission(key, 'example.com', now), false)
  assert.equal(isDuplicateSubmission(key, 'example.com', now + 20_001), false)
})
