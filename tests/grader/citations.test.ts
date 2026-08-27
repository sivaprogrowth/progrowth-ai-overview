import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateCitations, MAX_CITATION_DOMAINS } from '../../lib/grader/citations'
import { createBrandMatcher } from '../../lib/grader/brand-matcher'
import type { EngineAnswer } from '../../lib/grader/types'

const matcher = createBrandMatcher({ companyName: 'Acme Insurance', domain: 'acmeinsurance.com' })

function answer(overrides: Partial<EngineAnswer>): EngineAnswer {
  return {
    query: 'q',
    engine: 'chatgpt',
    answerText: '',
    brandMentioned: false,
    brandPosition: null,
    competitors: [],
    citations: [],
    costUsd: null,
    error: null,
    ...overrides,
  }
}

test('aggregateCitations counts mentions and coverage over answered pairs only', () => {
  const answers: EngineAnswer[] = [
    answer({ query: 'q1', citations: [{ domain: 'forbes.com', url: 'https://forbes.com/a', title: null }] }),
    answer({ query: 'q2', citations: [{ domain: 'forbes.com', url: 'https://forbes.com/b', title: null }] }),
    answer({ query: 'q3', citations: [] }),
    answer({ query: 'q4', error: 'provider failed' }), // excluded from denominator
  ]
  const summary = aggregateCitations(answers, matcher)
  const forbes = summary.domains.find((d) => d.domain === 'forbes.com')
  assert.ok(forbes)
  assert.equal(forbes!.mentions, 2)
  // denominator is 3 answered pairs (q1,q2,q3), forbes appears in 2 of them
  assert.equal(forbes!.coverage, Math.round((2 / 3) * 1000) / 10)
  assert.equal(forbes!.owned, false)
  assert.equal(forbes!.sourceType, 'publisher')
})

test('aggregateCitations flags owned domains and computes ownedShare/thirdPartyShare', () => {
  const answers: EngineAnswer[] = [
    answer({ citations: [{ domain: 'acmeinsurance.com', url: 'https://acmeinsurance.com', title: null }] }),
    answer({ citations: [{ domain: 'forbes.com', url: 'https://forbes.com', title: null }] }),
  ]
  const summary = aggregateCitations(answers, matcher)
  const owned = summary.domains.find((d) => d.domain === 'acmeinsurance.com')
  assert.equal(owned?.owned, true)
  assert.equal(owned?.sourceType, 'owned')
  assert.equal(summary.ownedShare, 50)
  assert.equal(summary.thirdPartyShare, 50)
  assert.equal(summary.thirdPartyDomains, 1)
})

test('aggregateCitations handles zero citations without dividing by zero', () => {
  const summary = aggregateCitations([answer({})], matcher)
  assert.equal(summary.totalCitations, 0)
  assert.equal(summary.ownedShare, 0)
  assert.equal(summary.thirdPartyShare, 0)
  assert.equal(summary.uniqueDomains, 0)
})

test('aggregateCitations caps the returned domain list at the limit', () => {
  const answers: EngineAnswer[] = []
  for (let i = 0; i < MAX_CITATION_DOMAINS + 5; i++) {
    answers.push(answer({ citations: [{ domain: `site${i}.com`, url: `https://site${i}.com`, title: null }] }))
  }
  const summary = aggregateCitations(answers, matcher)
  assert.equal(summary.domains.length, MAX_CITATION_DOMAINS)
  assert.equal(summary.uniqueDomains, MAX_CITATION_DOMAINS + 5)
})
