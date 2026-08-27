import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySource, isNonCompetitorDomain } from '../../lib/grader/sources'

test('classifySource matches curated domains and their subdomains', () => {
  assert.equal(classifySource('forbes.com'), 'publisher')
  assert.equal(classifySource('advisor.forbes.com'), 'publisher')
  assert.equal(classifySource('www.g2.com'), 'review')
  assert.equal(classifySource('reddit.com'), 'social')
  assert.equal(classifySource('wikipedia.org'), 'reference')
  assert.equal(classifySource('bbb.org'), 'directory')
})

test('classifySource returns null for an unclassified domain (no guessing)', () => {
  assert.equal(classifySource('some-random-insurance-brand.com'), null)
})

test('isNonCompetitorDomain flags every curated list', () => {
  assert.equal(isNonCompetitorDomain('forbes.com'), true)
  assert.equal(isNonCompetitorDomain('g2.com'), true)
  assert.equal(isNonCompetitorDomain('acme-insurance.com'), false)
})
