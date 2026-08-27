import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGraderRecommendations, MAX_RECOMMENDATIONS } from '../../lib/grader/recommendations'
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

test('buildGraderRecommendations returns 3-5 recommendations for a weak report', () => {
  const queries = [query({}), query({ category: 'brand_evaluation' })]
  const score = computeScore({
    queries,
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 0,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  const recs = buildGraderRecommendations({
    score,
    queries,
    citations: emptyCitations,
    competitors: [],
    readiness: unavailableReadiness,
    companyName: 'Acme Insurance',
  })
  assert.ok(recs.length >= 3, `expected >= 3, got ${recs.length}`)
  assert.ok(recs.length <= MAX_RECOMMENDATIONS)
})

test('buildGraderRecommendations sorts by priority (high before medium before low)', () => {
  const queries = [query({})]
  const score = computeScore({
    queries,
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 0,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  const recs = buildGraderRecommendations({
    score,
    queries,
    citations: emptyCitations,
    competitors: [],
    readiness: unavailableReadiness,
    companyName: 'Acme Insurance',
  })
  const rank = { high: 0, medium: 1, low: 2 }
  for (let i = 1; i < recs.length; i++) {
    assert.ok(rank[recs[i - 1].priority] <= rank[recs[i].priority])
  }
})

test('buildGraderRecommendations flags a dominant competitor with a comparison-page rule', () => {
  const queries = [query({ brandMentioned: true, brandPosition: 5 })]
  const competitors: CompetitorResult[] = [{ name: 'Beta Insurance', mentions: 10, queriesPresent: 8, shareOfVoice: 90 }]
  const score = computeScore({
    queries,
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors,
    brandMentionCount: 1,
    totalCompetitorMentions: 10,
    readiness: unavailableReadiness,
  })
  const recs = buildGraderRecommendations({
    score,
    queries,
    citations: emptyCitations,
    competitors,
    readiness: unavailableReadiness,
    companyName: 'Acme Insurance',
  })
  assert.ok(recs.some((r) => r.category === 'competitive' && r.title.toLowerCase().includes('comparison')))
})

test('buildGraderRecommendations never invents a DEBUNKED_TACTICS-style claim', () => {
  const queries = [query({})]
  const score = computeScore({
    queries,
    citations: emptyCitations,
    sentiment: unknownSentiment,
    competitors: [],
    brandMentionCount: 0,
    totalCompetitorMentions: 0,
    readiness: unavailableReadiness,
  })
  const recs = buildGraderRecommendations({
    score,
    queries,
    citations: emptyCitations,
    competitors: [],
    readiness: unavailableReadiness,
    companyName: 'Acme Insurance',
  })
  for (const r of recs) {
    assert.ok(!/llms\.txt/i.test(r.action))
  }
})

test('buildGraderRecommendations gives a maintain-visibility fallback for a strong report', () => {
  const queries: QueryAnalysisResult[] = [
    query({ query: 'a', brandMentioned: true, brandPosition: 1, category: 'category_discovery' }),
    query({ query: 'b', brandMentioned: true, brandPosition: 1, category: 'recommendation_intent' }),
    query({ query: 'c', brandMentioned: true, brandPosition: 1, category: 'brand_evaluation' }),
    query({ query: 'd', brandMentioned: true, brandPosition: 1, category: 'alternatives_comparison' }),
  ]
  const citations: CitationSummary = {
    domains: [{ domain: 'acme.com', mentions: 10, coverage: 100, owned: true, sourceType: 'owned' }],
    uniqueDomains: 10,
    totalCitations: 10,
    ownedShare: 100,
    thirdPartyShare: 0,
    thirdPartyDomains: 9,
  }
  const sentiment: SentimentSummary = {
    sentiment: 'positive',
    confidence: 0.9,
    analyzed: 4,
    byLabel: { positive: 4, neutral: 0, negative: 0, mixed: 0, unknown: 0 },
    error: null,
  }
  const readiness: ReadinessResult = { status: 'ok', checks: [], passedCount: 10, evaluatedCount: 10, error: null }
  const score = computeScore({
    queries,
    citations,
    sentiment,
    competitors: [],
    brandMentionCount: 20,
    totalCompetitorMentions: 0,
    readiness,
  })
  const recs = buildGraderRecommendations({
    score,
    queries,
    citations,
    competitors: [],
    readiness,
    companyName: 'Acme Insurance',
  })
  assert.ok(recs.length >= 3)
})
