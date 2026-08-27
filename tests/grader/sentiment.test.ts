import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyAnswerSentiment, summarizeSentiment, sentimentIndex } from '../../lib/grader/sentiment'
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

test('classifyAnswerSentiment returns unknown when the brand is not named', () => {
  const result = classifyAnswerSentiment(answer({ answerText: 'Some other company is great.' }), matcher)
  assert.equal(result.sentiment, 'unknown')
  assert.equal(result.confidence, 0)
})

test('classifyAnswerSentiment returns unknown for a failed answer', () => {
  const result = classifyAnswerSentiment(answer({ error: 'timeout', answerText: 'Acme Insurance is great' }), matcher)
  assert.equal(result.sentiment, 'unknown')
})

test('classifyAnswerSentiment detects positive framing', () => {
  const result = classifyAnswerSentiment(
    answer({ answerText: 'Acme Insurance is a highly recommended and trusted provider.' }),
    matcher
  )
  assert.equal(result.sentiment, 'positive')
  assert.ok(result.confidence > 0)
})

test('classifyAnswerSentiment detects negative framing', () => {
  const result = classifyAnswerSentiment(
    answer({ answerText: 'Acme Insurance has many complaints and a lawsuit pending.' }),
    matcher
  )
  assert.equal(result.sentiment, 'negative')
})

test('classifyAnswerSentiment detects mixed framing (both cues present)', () => {
  const result = classifyAnswerSentiment(
    answer({ answerText: 'Acme Insurance is highly recommended, however there are complaints about claims.' }),
    matcher
  )
  assert.equal(result.sentiment, 'mixed')
})

test('classifyAnswerSentiment returns neutral for a plain factual mention', () => {
  const result = classifyAnswerSentiment(
    answer({ answerText: 'Acme Insurance is located in Texas and was founded in 1990.' }),
    matcher
  )
  assert.equal(result.sentiment, 'neutral')
})

test('summarizeSentiment returns unknown with analyzed=0 when brand never named', () => {
  const summary = summarizeSentiment([answer({ answerText: 'no mention here' })], matcher)
  assert.equal(summary.sentiment, 'unknown')
  assert.equal(summary.analyzed, 0)
  assert.equal(summary.error, null)
})

test('sentimentIndex is null when nothing was analyzed', () => {
  const summary = summarizeSentiment([answer({})], matcher)
  assert.equal(sentimentIndex(summary), null)
})

test('sentimentIndex returns 1 for a fully positive summary', () => {
  const answers = [
    answer({ answerText: 'Acme Insurance is a highly recommended, trusted, reliable provider.' }),
    answer({ answerText: 'Acme Insurance is an excellent, top choice, well-regarded provider.' }),
  ]
  const summary = summarizeSentiment(answers, matcher)
  assert.equal(summary.analyzed, 2)
  assert.equal(sentimentIndex(summary), 1)
})
