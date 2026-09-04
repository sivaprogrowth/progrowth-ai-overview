import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeScore } from '../../lib/grader/scoring'
import type {
  CitationSummary,
  CompetitorResult,
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

test('computeScore is deterministic — same input, same output', () => {
  const input = {
    queries: [query({ brandMentioned: true, brandPosition: 1 })],
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [] as CompetitorResult[],
    brandMentionCount: 1,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  }
  const a = computeScore(input)
  const b = computeScore(input)
  assert.deepEqual(a, b)
})

test('computeScore never exceeds 100 or drops below 0', () => {
  const perfectQueries: QueryAnalysisResult[] = Array.from({ length: 8 }, (_, i) =>
    query({
      query: `q${i}`,
      brandMentioned: true,
      brandPosition: 1,
      category: (['category_discovery', 'recommendation_intent', 'brand_evaluation', 'alternatives_comparison'] as const)[i % 4],
      // Citation-authority coverage is measured per query — an "all
      // categories, all engines" perfect run also carries a citation on
      // every answered query, not just at the aggregate citations summary.
      citations: [{ domain: 'acme.com', url: 'https://acme.com', title: null }],
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
    brandMentionCount: 50,
    totalCompetitorMentions: 0,
    readiness: perfectReadiness,
  })
  assert.ok(score.overall <= 100)
  assert.equal(score.overall, 100)
  assert.equal(score.grade, 'Excellent')
})

test('computeScore returns 0 competitive score with no comparative data at all', () => {
  const score = computeScore({
    queries: [query({})],
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 0,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  assert.equal(score.competitive, 0)
})

test('computeScore falls back sentiment to the neutral midpoint when unmeasured', () => {
  const score = computeScore({
    queries: [query({})],
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 0,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  assert.equal(score.sentiment, 7.5)
})

test('computeScore gives 0 readiness when evaluatedCount is 0', () => {
  const score = computeScore({
    queries: [query({})],
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 0,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  assert.equal(score.readiness, 0)
})

test('computeScore category scores sum to the overall score', () => {
  const score = computeScore({
    queries: [query({ brandMentioned: true, brandPosition: 2 })],
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 1,
    totalCompetitorMentions: 1,
    readiness: unavailableReadiness,
  })
  const sum = score.categories.reduce((s, c) => s + c.score, 0)
  assert.ok(Math.abs(sum - score.overall) < 0.15)
})

test('computeScore rewards answer coverage breadth, not just mention count', () => {
  const narrow = computeScore({
    queries: [
      query({ query: 'a', category: 'brand_evaluation', brandMentioned: true }),
      query({ query: 'b', category: 'brand_evaluation', brandMentioned: true }),
      query({ query: 'c', category: 'category_discovery', brandMentioned: false }),
    ],
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 2,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  const broad = computeScore({
    queries: [
      query({ query: 'a', category: 'brand_evaluation', brandMentioned: true }),
      query({ query: 'c', category: 'category_discovery', brandMentioned: true }),
    ],
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 2,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  assert.ok(broad.coverage > narrow.coverage)
})
