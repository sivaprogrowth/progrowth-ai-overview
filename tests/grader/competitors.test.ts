import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractBrandCandidates, aggregateCompetitors, prettifyStem, MAX_COMPETITORS } from '../../lib/grader/competitors'
import { createBrandMatcher } from '../../lib/grader/brand-matcher'
import type { EngineAnswer } from '../../lib/grader/types'

const matcher = createBrandMatcher({ companyName: 'Acme Insurance', domain: 'acmeinsurance.com' })

function answer(overrides: Partial<EngineAnswer>): EngineAnswer {
  return {
    query: 'best insurance companies',
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

test('extractBrandCandidates pulls names from bold list items', () => {
  const text = '1. **Beta Insurance** - great rates\n2. **Gamma Corp** - solid coverage'
  const names = extractBrandCandidates(text, [], matcher)
  assert.deepEqual(names.sort(), ['Beta Insurance', 'Gamma Corp'].sort())
})

test('extractBrandCandidates pulls names from markdown links', () => {
  const text = 'Consider [Beta Insurance](https://beta-insurance.com) for coverage.'
  const names = extractBrandCandidates(text, [], matcher)
  assert.ok(names.includes('Beta Insurance'))
})

test('extractBrandCandidates excludes the graded brand itself', () => {
  const text = '**Acme Insurance** is a solid choice, as is **Beta Insurance**.'
  const names = extractBrandCandidates(text, [], matcher)
  assert.ok(!names.includes('Acme Insurance'))
  assert.ok(names.includes('Beta Insurance'))
})

test('extractBrandCandidates excludes section headings and generic words', () => {
  const text = '### Pros and Cons\n- Best options for you\n**Beta Insurance** is solid.'
  const names = extractBrandCandidates(text, [], matcher)
  assert.ok(!names.some((n) => /pros and cons/i.test(n)))
  assert.ok(names.includes('Beta Insurance'))
})

test('extractBrandCandidates derives a name from a non-publisher citation domain', () => {
  const citations = [{ domain: 'beta-insurance.com', url: 'https://beta-insurance.com', title: null }]
  const names = extractBrandCandidates('', citations, matcher)
  assert.ok(names.includes(prettifyStem('beta-insurance')))
})

test('extractBrandCandidates does not treat a publisher citation as a competitor', () => {
  const citations = [{ domain: 'forbes.com', url: 'https://forbes.com/x', title: null }]
  const names = extractBrandCandidates('', citations, matcher)
  assert.equal(names.length, 0)
})

test('aggregateCompetitors shares of voice sum with the brand to ~100%', () => {
  const answers: EngineAnswer[] = [
    answer({ competitors: ['Beta Insurance'] }),
    answer({ competitors: ['Beta Insurance'] }),
    answer({ competitors: ['Gamma Corp'] }),
  ]
  const brandMentionCount = 4
  const { competitors, totalCompetitorMentions } = aggregateCompetitors(answers, brandMentionCount)
  assert.equal(totalCompetitorMentions, 3)
  const shareSum = competitors.reduce((s, c) => s + c.shareOfVoice, 0)
  assert.ok(Math.abs(shareSum + (brandMentionCount / (brandMentionCount + totalCompetitorMentions)) * 100 - 100) < 0.5)
})

test('aggregateCompetitors caps at MAX_COMPETITORS and ranks by query breadth then mentions', () => {
  const answers: EngineAnswer[] = []
  const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  for (const name of names) {
    answers.push(answer({ query: `q-${name}`, competitors: [name] }))
  }
  const { competitors } = aggregateCompetitors(answers, 0)
  assert.equal(competitors.length, MAX_COMPETITORS)
})

test('aggregateCompetitors returns zero shares with no evidence at all', () => {
  const { competitors, totalCompetitorMentions } = aggregateCompetitors([], 0)
  assert.equal(competitors.length, 0)
  assert.equal(totalCompetitorMentions, 0)
})
