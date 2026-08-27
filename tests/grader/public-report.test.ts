import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toPublicGraderReport } from '../../lib/grader/public-report'
import type { EngineAnswer, GraderReport, QueryAnalysisResult } from '../../lib/grader/types'

function answer(overrides: Partial<EngineAnswer>): EngineAnswer {
  return {
    query: 'q',
    engine: 'chatgpt',
    answerText: 'hello',
    brandMentioned: false,
    brandPosition: null,
    competitors: [],
    citations: [],
    costUsd: 0.02,
    error: null,
    ...overrides,
  }
}

function query(per: EngineAnswer[]): QueryAnalysisResult {
  return {
    query: 'q',
    category: 'category_discovery',
    priority: 'high',
    brandMentioned: false,
    brandPosition: null,
    enginesMentioning: [],
    enginesAnswered: [],
    answerText: '',
    competitors: [],
    citations: [],
    sentiment: 'unknown',
    per,
  }
}

function baseReport(overrides: Partial<GraderReport> = {}): GraderReport {
  return {
    company: { companyName: 'Acme', domain: 'acme.com', industry: 'Insurance', service: null, location: null },
    score: {
      overall: 50, grade: 'Moderate', categories: [],
      visibility: 10, citation: 10, sentiment: 10, competitive: 10, coverage: 5, readiness: 5,
    },
    queries: [],
    competitors: [],
    citations: { domains: [], uniqueDomains: 0, totalCitations: 0, ownedShare: 0, thirdPartyShare: 0, thirdPartyDomains: 0 },
    sentiment: { sentiment: 'unknown', confidence: 0, analyzed: 0, byLabel: { positive: 0, neutral: 0, negative: 0, mixed: 0, unknown: 0 }, error: null },
    readiness: { status: 'ok', checks: [], passedCount: 0, evaluatedCount: 0, error: null },
    recommendations: [],
    summary: 'summary text',
    usage: { dataforseoRequests: 30, llmCalls: 31, estimatedCostUsd: 0.42, durationMs: 12345 },
    warnings: ['chatgpt failed for "q": daily spend cap reached ($47.32/$50.00)'],
    ...overrides,
  }
}

test('toPublicGraderReport strips usage and warnings entirely', () => {
  const pub = toPublicGraderReport(baseReport())
  assert.equal((pub as any).usage, undefined)
  assert.equal((pub as any).warnings, undefined)
})

test('toPublicGraderReport redacts per-engine error text but preserves non-null-ness', () => {
  const report = baseReport({
    queries: [query([answer({ error: 'daily spend cap reached ($47.32/$50.00)' }), answer({ error: null })])],
  })
  const pub = toPublicGraderReport(report)
  const [failed, ok] = pub.queries[0].per
  assert.equal(failed.error, 'unavailable')
  assert.ok(!failed.error!.includes('$'))
  assert.equal(ok.error, null)
})

test('toPublicGraderReport strips costUsd from every engine answer', () => {
  const report = baseReport({ queries: [query([answer({ costUsd: 1.23 })])] })
  const pub = toPublicGraderReport(report)
  assert.equal(pub.queries[0].per[0].costUsd, null)
})

test('toPublicGraderReport clears sentiment.error', () => {
  const report = baseReport({ sentiment: { sentiment: 'unknown', confidence: 0, analyzed: 0, byLabel: { positive: 0, neutral: 0, negative: 0, mixed: 0, unknown: 0 }, error: 'internal classifier detail' } })
  const pub = toPublicGraderReport(report)
  assert.equal(pub.sentiment.error, null)
})

test('toPublicGraderReport leaves score/competitors/citations/recommendations/summary untouched', () => {
  const report = baseReport({
    competitors: [{ name: 'Beta', mentions: 3, queriesPresent: 2, shareOfVoice: 20 }],
  })
  const pub = toPublicGraderReport(report)
  assert.deepEqual(pub.score, report.score)
  assert.deepEqual(pub.competitors, report.competitors)
  assert.deepEqual(pub.citations, report.citations)
  assert.equal(pub.summary, report.summary)
})

test('toPublicGraderReport never crashes on a query with zero engine answers', () => {
  const report = baseReport({ queries: [query([])] })
  const pub = toPublicGraderReport(report)
  assert.deepEqual(pub.queries[0].per, [])
})
