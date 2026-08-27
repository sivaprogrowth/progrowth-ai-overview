import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gradeFor, round1, clampScore, GRADE_BANDS } from '../../lib/grader/grade'

test('gradeFor maps bands correctly at boundaries', () => {
  assert.equal(gradeFor(100), 'Excellent')
  assert.equal(gradeFor(90), 'Excellent')
  assert.equal(gradeFor(89.9), 'Strong')
  assert.equal(gradeFor(75), 'Strong')
  assert.equal(gradeFor(74.9), 'Moderate')
  assert.equal(gradeFor(60), 'Moderate')
  assert.equal(gradeFor(59.9), 'Weak')
  assert.equal(gradeFor(40), 'Weak')
  assert.equal(gradeFor(39.9), 'Critical')
  assert.equal(gradeFor(0), 'Critical')
})

test('gradeFor clamps out-of-range input', () => {
  assert.equal(gradeFor(150), 'Excellent')
  assert.equal(gradeFor(-10), 'Critical')
})

test('GRADE_BANDS is a single source of truth, sorted descending', () => {
  for (let i = 1; i < GRADE_BANDS.length; i++) {
    assert.ok(GRADE_BANDS[i - 1].min > GRADE_BANDS[i].min)
  }
})

test('round1 rounds to one decimal place', () => {
  assert.equal(round1(1.234), 1.2)
  assert.equal(round1(1.25), 1.3)
})

test('clampScore bounds into [0, max] and rounds', () => {
  assert.equal(clampScore(-5, 30), 0)
  assert.equal(clampScore(35, 30), 30)
  assert.equal(clampScore(NaN, 30), 0)
  assert.equal(clampScore(12.34, 30), 12.3)
})
