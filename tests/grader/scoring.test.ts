import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeScore } from '../../lib/grader/scoring'
import type {
  CitationSummary,
  EngineAnswer,
  GraderEngine,
  QueryAnalysisResult,
  ReadinessResult,
  SentimentSummary,
} from '../../lib/grader/types'

function query(overrides: Partial<QueryAnalysisResult>): QueryAnalysisResult {
  return {
    query: 'q',
    category: 'category_discovery',
    priority: 'high',
    brandMentioned: false,
    brandPosition: null,
    enginesMentioning: [],
    enginesAnswered: ['chatgpt'],
    answerText: '',
    competitors: [],
    citations: [],
    sentiment: 'unknown',
    per: [],
    ...overrides,
  }
}

function answer(engine: GraderEngine, overrides: Partial<EngineAnswer> = {}): EngineAnswer {
  return {
    query: 'q',
    engine,
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

const emptyCitations: CitationSummary = {
  domains: [],
  uniqueDomains: 0,
  totalCitations: 0,
  ownedShare: 0,
  thirdPartyShare: 0,
  thirdPartyDomains: 0,
}

const unknownSentiment: SentimentSummary = {
  sentiment: 'unknown',
  confidence: 0,
  analyzed: 0,
  byLabel: { positive: 0, neutral: 0, negative: 0, mixed: 0, unknown: 0 },
  error: null,
}

const unavailableReadiness: ReadinessResult = {
  status: 'unavailable',
  checks: [],
  passedCount: 0,
  evaluatedCount: 0,
  error: 'homepage unreachable',
}

function scoreQueries(queries: QueryAnalysisResult[], citations: CitationSummary = emptyCitations) {
  return computeScore({
    queries,
    citations,
    sentiment: unknownSentiment,
    competitors: [],
    readiness: unavailableReadiness,
  })
}

test('computeScore is deterministic — same input, same output', () => {
  const queries = [
    query({
      brandMentioned: true,
      brandPosition: 1,
      enginesMentioning: ['chatgpt'],
      per: [answer('chatgpt', { brandMentioned: true, brandPosition: 1, competitors: ['Beta'] })],
    }),
  ]
  assert.deepEqual(scoreQueries(queries), scoreQueries(queries))
})

test('computeScore never exceeds 100 or drops below 0', () => {
  const perfectQueries: QueryAnalysisResult[] = Array.from({ length: 8 }, (_, i) =>
    query({
      query: `q${i}`,
      brandMentioned: true,
      brandPosition: 1,
      enginesMentioning: ['chatgpt'],
      category: (['category_discovery', 'recommendation_intent', 'brand_evaluation', 'alternatives_comparison'] as const)[i % 4],
      priority: i % 4 < 2 ? 'high' : 'medium',
      citations: [{ domain: 'acme.com', url: 'https://acme.com', title: null }],
      per: [answer('chatgpt', { query: `q${i}`, brandMentioned: true, brandPosition: 1 })],
    })
  )
  const perfectCitations: CitationSummary = {
    domains: [{ domain: 'acme.com', mentions: 10, coverage: 100, owned: true, sourceType: 'owned' }],
    uniqueDomains: 10,
    totalCitations: 10,
    ownedShare: 100,
    thirdPartyShare: 0,
    thirdPartyDomains: 9,
  }
  const perfectSentiment: SentimentSummary = {
    sentiment: 'positive',
    confidence: 0.9,
    analyzed: 8,
    byLabel: { positive: 8, neutral: 0, negative: 0, mixed: 0, unknown: 0 },
    error: null,
  }
  const perfectReadiness: ReadinessResult = {
    status: 'ok',
    checks: [],
    passedCount: 10,
    evaluatedCount: 10,
    error: null,
  }
  const score = computeScore({
    queries: perfectQueries,
    citations: perfectCitations,
    sentiment: perfectSentiment,
    competitors: [],
    readiness: perfectReadiness,
  })
  assert.ok(score.overall <= 100)
  assert.equal(score.overall, 100)
  assert.equal(score.grade, 'Excellent')
})

test('computeScore returns 0 competitive score with no comparative data at all', () => {
  assert.equal(scoreQueries([query({})]).competitive, 0)
})

test('computeScore falls back sentiment to the neutral midpoint when unmeasured', () => {
  assert.equal(scoreQueries([query({})]).sentiment, 7.5)
})

test('computeScore gives 0 readiness when evaluatedCount is 0', () => {
  assert.equal(scoreQueries([query({})]).readiness, 0)
})

test('computeScore category scores sum to the overall score', () => {
  const score = scoreQueries([
    query({
      brandMentioned: true,
      brandPosition: 2,
      enginesMentioning: ['chatgpt'],
      per: [answer('chatgpt', { brandMentioned: true, brandPosition: 2, competitors: ['Beta'] })],
    }),
  ])
  const sum = score.categories.reduce((s, c) => s + c.score, 0)
  assert.ok(Math.abs(sum - score.overall) < 0.15)
})

test('computeScore rewards answer coverage breadth, not just mention count', () => {
  const narrow = scoreQueries([
    query({ query: 'a', category: 'brand_evaluation', brandMentioned: true, enginesMentioning: ['chatgpt'] }),
    query({ query: 'b', category: 'brand_evaluation', brandMentioned: true, enginesMentioning: ['chatgpt'] }),
    query({ query: 'c', category: 'category_discovery', brandMentioned: false }),
  ])
  const broad = scoreQueries([
    query({ query: 'a', category: 'brand_evaluation', brandMentioned: true, enginesMentioning: ['chatgpt'] }),
    query({ query: 'c', category: 'category_discovery', brandMentioned: true, enginesMentioning: ['chatgpt'] }),
  ])
  assert.ok(broad.coverage > narrow.coverage)
})

test('visibility counts each AI answer, not "any engine" per query', () => {
  const allEngines = ['chatgpt', 'perplexity', 'claude'] as GraderEngine[]
  const oneOfThree = scoreQueries([
    query({ brandMentioned: true, enginesAnswered: allEngines, enginesMentioning: ['chatgpt'] }),
  ])
  const threeOfThree = scoreQueries([
    query({ brandMentioned: true, enginesAnswered: allEngines, enginesMentioning: allEngines }),
  ])
  // presence 1/3 → 6.7 of 20, high-priority 1/3 → 1.7 of 5
  assert.equal(oneOfThree.visibility, 8.3)
  assert.equal(threeOfThree.visibility, 25)
})

test('citation authority ignores third-party citations and credits only the brand site', () => {
  const thirdPartyOnly = scoreQueries(
    [
      query({
        citations: [{ domain: 'reviews.example', url: 'https://reviews.example', title: null }],
        per: [answer('chatgpt', { citations: [{ domain: 'reviews.example', url: 'https://reviews.example', title: null }] })],
      }),
    ],
    { ...emptyCitations, uniqueDomains: 12, totalCitations: 12, thirdPartyShare: 100, thirdPartyDomains: 12 }
  )
  assert.equal(thirdPartyOnly.citation, 0)

  // Own site cited in 1 of 2 answers (5 pts) with a 12.5% owned share (5 pts).
  const halfOwned = scoreQueries(
    [
      query({
        enginesAnswered: ['chatgpt', 'perplexity'],
        per: [answer('chatgpt', { brandPosition: 1 }), answer('perplexity')],
      }),
    ],
    { ...emptyCitations, totalCitations: 8, ownedShare: 12.5, thirdPartyShare: 87.5 }
  )
  assert.equal(halfOwned.citation, 10)
})

test('failed engine answers never count toward citation or competitive credit', () => {
  const score = scoreQueries([
    query({
      per: [
        answer('chatgpt', { brandMentioned: true, brandPosition: 1 }),
        answer('claude', { error: 'timeout', brandPosition: 1, competitors: ['Beta'] }),
      ],
    }),
  ])
  assert.equal(score.competitive, 15)
  assert.match(score.categories.find((c) => c.id === 'citation')!.detail, /cited in 1\/1 AI answers/)
})

test('competitive share ignores branded queries, where the brand is in the question', () => {
  const score = scoreQueries([
    query({
      query: 'acme reviews',
      category: 'brand_evaluation',
      priority: 'medium',
      per: [answer('chatgpt', { brandMentioned: true }), answer('claude', { brandMentioned: true })],
    }),
    query({
      query: 'best insurance',
      per: [answer('chatgpt', { competitors: ['Beta Insurance'] })],
    }),
  ])
  assert.equal(score.competitive, 0)
})

test('competitive share compares brand answers with the most-visible competitor', () => {
  const generic = (per: EngineAnswer[]) => query({ query: 'best insurance', per })
  const matching = scoreQueries([
    generic([
      answer('chatgpt', { brandMentioned: true, competitors: ['Beta'] }),
      answer('perplexity', { brandMentioned: true, competitors: ['Beta', 'Gamma'] }),
    ]),
  ])
  assert.equal(matching.competitive, 15)

  const half = scoreQueries([
    generic([
      answer('chatgpt', { brandMentioned: true, competitors: ['Beta'] }),
      answer('perplexity', { competitors: ['Beta', 'Gamma'] }),
    ]),
  ])
  assert.equal(half.competitive, 7.5)
  assert.match(half.categories.find((c) => c.id === 'competitive')!.detail, /vs 2 for the most-visible competitor \(Beta\)/)
})
