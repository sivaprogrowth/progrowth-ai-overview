import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQueryResults } from '../../lib/grader/query-results'
import { createBrandMatcher } from '../../lib/grader/brand-matcher'
import type { EngineAnswer, GeneratedQuery } from '../../lib/grader/types'

const matcher = createBrandMatcher({ companyName: 'Acme Insurance', domain: 'acmeinsurance.com' })

function answer(overrides: Partial<EngineAnswer>): EngineAnswer {
  return {
    query: 'best insurance',
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

const plan: GeneratedQuery[] = [
  { query: 'best insurance', category: 'category_discovery', priority: 'high', source: 'template' },
  { query: 'acme reviews', category: 'brand_evaluation', priority: 'medium', source: 'template' },
]

test('buildQueryResults groups answers by query and marks brandMentioned from any engine', () => {
  const answers: EngineAnswer[] = [
    answer({ query: 'best insurance', engine: 'chatgpt', brandMentioned: false }),
    answer({ query: 'best insurance', engine: 'perplexity', brandMentioned: true, brandPosition: 2 }),
    answer({ query: 'acme reviews', engine: 'chatgpt', error: 'timeout' }),
  ]
  const results = buildQueryResults(plan, answers, matcher)
  const best = results.find((r) => r.query === 'best insurance')!
  assert.equal(best.brandMentioned, true)
  assert.deepEqual(best.enginesMentioning, ['perplexity'])
  assert.deepEqual(best.enginesAnswered.sort(), ['chatgpt', 'perplexity'].sort())
  assert.equal(best.brandPosition, 2)

  const reviews = results.find((r) => r.query === 'acme reviews')!
  assert.equal(reviews.brandMentioned, false)
  assert.deepEqual(reviews.enginesAnswered, [])
})

test('buildQueryResults takes the best (lowest) brandPosition across engines', () => {
  const answers: EngineAnswer[] = [
    answer({ query: 'best insurance', engine: 'chatgpt', brandMentioned: true, brandPosition: 4 }),
    answer({ query: 'best insurance', engine: 'perplexity', brandMentioned: true, brandPosition: 1 }),
  ]
  const results = buildQueryResults(plan, answers, matcher)
  const best = results.find((r) => r.query === 'best insurance')!
  assert.equal(best.brandPosition, 1)
})

test('buildQueryResults returns an entry (with no evidence) even for a query with zero answers', () => {
  const results = buildQueryResults(plan, [], matcher)
  assert.equal(results.length, plan.length)
  for (const r of results) {
    assert.equal(r.brandMentioned, false)
    assert.equal(r.per.length, 0)
  }
})

test('buildQueryResults dedupes competitors and citations across engines', () => {
  const answers: EngineAnswer[] = [
    answer({ query: 'best insurance', engine: 'chatgpt', competitors: ['Beta Insurance'] }),
    answer({ query: 'best insurance', engine: 'perplexity', competitors: ['Beta Insurance', 'Gamma Corp'] }),
  ]
  const results = buildQueryResults(plan, answers, matcher)
  const best = results.find((r) => r.query === 'best insurance')!
  assert.deepEqual(best.competitors.sort(), ['Beta Insurance', 'Gamma Corp'].sort())
})

test('buildQueryResults picks the worst sentiment among engines naming the brand', () => {
  const answers: EngineAnswer[] = [
    answer({
      query: 'best insurance',
      engine: 'chatgpt',
      brandMentioned: true,
      answerText: 'Acme Insurance is a highly recommended, trusted provider.',
    }),
    answer({
      query: 'best insurance',
      engine: 'perplexity',
      brandMentioned: true,
      answerText: 'Acme Insurance has faced complaints and a lawsuit.',
    }),
  ]
  const results = buildQueryResults(plan, answers, matcher)
  const best = results.find((r) => r.query === 'best insurance')!
  assert.equal(best.sentiment, 'negative')
})
