import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gradeTone,
  formatScore,
  formatPercent,
  categoryLabel,
  engineLabel,
  priorityLabel,
  priorityTone,
  presenceLabel,
  presenceTone,
  readinessStatusLabel,
  readinessTone,
  sourceTypeLabel,
  wrappableDomain,
  deriveEngineSummaries,
  engineTagline,
  engineInterpretation,
  engineComparisonSummary,
  type EngineSummary,
} from '../../lib/grader/format'
import type { EngineAnswer, QueryAnalysisResult } from '../../lib/grader/types'

test('gradeTone maps every grade to a tone', () => {
  assert.equal(gradeTone('Excellent'), 'success')
  assert.equal(gradeTone('Strong'), 'accent')
  assert.equal(gradeTone('Moderate'), 'warning')
  assert.equal(gradeTone('Weak'), 'danger')
  assert.equal(gradeTone('Critical'), 'danger')
})

test('formatScore rounds to a whole number for display only', () => {
  assert.equal(formatScore(71.6), '72')
  assert.equal(formatScore(71.4), '71')
})

test('formatPercent renders whole numbers without a decimal, fractions with one', () => {
  assert.equal(formatPercent(50), '50%')
  assert.equal(formatPercent(27.55), '27.6%')
})

test('categoryLabel covers every QueryCategory', () => {
  assert.equal(categoryLabel('category_discovery'), 'Discovery')
  assert.equal(categoryLabel('recommendation_intent'), 'Recommendation')
  assert.equal(categoryLabel('brand_evaluation'), 'Brand')
  assert.equal(categoryLabel('alternatives_comparison'), 'Comparison')
})

test('engineLabel only ever names the three Phase 1 answer engines', () => {
  assert.equal(engineLabel('chatgpt'), 'ChatGPT')
  assert.equal(engineLabel('perplexity'), 'Perplexity')
  assert.equal(engineLabel('claude'), 'Claude')
})

test('priorityLabel/priorityTone cover every priority', () => {
  assert.equal(priorityLabel('high'), 'High Priority')
  assert.equal(priorityTone('high'), 'danger')
  assert.equal(priorityLabel('medium'), 'Medium Priority')
  assert.equal(priorityTone('medium'), 'warning')
  assert.equal(priorityLabel('low'), 'Low Priority')
  assert.equal(priorityTone('low'), 'accent')
})

test('presenceLabel buckets by mention rate, not raw count', () => {
  assert.equal(presenceLabel(0, 10), 'Not Mentioned')
  assert.equal(presenceLabel(2, 10), 'Weak')
  assert.equal(presenceLabel(4, 10), 'Moderate')
  assert.equal(presenceLabel(7, 10), 'Strong')
  assert.equal(presenceLabel(0, 0), 'Not Mentioned')
})

test('presenceTone matches presenceLabel', () => {
  assert.equal(presenceTone('Strong'), 'success')
  assert.equal(presenceTone('Moderate'), 'warning')
  assert.equal(presenceTone('Weak'), 'danger')
  assert.equal(presenceTone('Not Mentioned'), 'muted')
})

test('readinessStatusLabel never reports null (unevaluated) as a failure', () => {
  assert.equal(readinessStatusLabel(null), 'Not evaluated')
  assert.equal(readinessStatusLabel(true), 'Pass')
  assert.equal(readinessStatusLabel(false), 'Needs Attention')
})

test('readinessTone treats null as muted, not danger', () => {
  assert.equal(readinessTone(null), 'muted')
  assert.equal(readinessTone(true), 'success')
  assert.equal(readinessTone(false), 'warning')
})

test('sourceTypeLabel renders null for an unclassified source (never guesses)', () => {
  assert.equal(sourceTypeLabel(null), null)
  assert.equal(sourceTypeLabel('owned'), 'Owned')
  assert.equal(sourceTypeLabel('publisher'), 'Publisher')
})

test('wrappableDomain inserts a break opportunity after every dot', () => {
  const result = wrappableDomain('sub.example.com')
  assert.equal(result.split('.').length, 3)
  assert.ok(result.includes('​'))
})

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

function query(per: EngineAnswer[]): QueryAnalysisResult {
  return {
    query: 'q',
    category: 'category_discovery',
    priority: 'high',
    brandMentioned: per.some((a) => a.brandMentioned),
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

// ── deriveEngineSummaries / engineTagline / engineInterpretation /
//    engineComparisonSummary (multi-engine scorecard) ─────────────────────

test('deriveEngineSummaries: 3 engines, all successful, in fixed stable order', () => {
  const queries = [
    query([
      answer({ engine: 'chatgpt', brandMentioned: true, brandPosition: 1, citations: [{ domain: 'g2.com', url: 'https://g2.com', title: null }] }),
      answer({ engine: 'claude', brandMentioned: true }),
      answer({ engine: 'perplexity', brandMentioned: false }),
    ]),
  ]
  const rows = deriveEngineSummaries(queries)
  assert.deepEqual(rows.map((r) => r.engine), ['chatgpt', 'perplexity', 'claude'])
  assert.equal(rows.every((r) => r.available), true)
})

test('deriveEngineSummaries: 2 engines — a third engine never attempted does not appear', () => {
  const queries = [query([answer({ engine: 'chatgpt', brandMentioned: true }), answer({ engine: 'perplexity', brandMentioned: false })])]
  const rows = deriveEngineSummaries(queries)
  assert.deepEqual(rows.map((r) => r.engine), ['chatgpt', 'perplexity'])
})

test('deriveEngineSummaries: 1 engine — only that engine appears', () => {
  const queries = [query([answer({ engine: 'claude', brandMentioned: true })])]
  const rows = deriveEngineSummaries(queries)
  assert.deepEqual(rows.map((r) => r.engine), ['claude'])
})

test('deriveEngineSummaries: an engine that errored on EVERY call still appears, marked unavailable', () => {
  const queries = [
    query([answer({ engine: 'chatgpt', brandMentioned: true }), answer({ engine: 'claude', error: 'timeout' })]),
    query([answer({ engine: 'chatgpt', brandMentioned: true }), answer({ engine: 'claude', error: 'timeout' })]),
  ]
  const rows = deriveEngineSummaries(queries)
  const claude = rows.find((r) => r.engine === 'claude')!
  assert.ok(claude, 'a fully-failed engine must still get a row, not be silently omitted')
  assert.equal(claude.available, false)
  assert.equal(claude.answeredCount, 0)
  assert.equal(claude.attemptedCount, 2)
  assert.equal(claude.mentionRate, 0)
})

test('deriveEngineSummaries: partial report — engine with SOME failed calls still counts only the successes', () => {
  const queries = [
    query([answer({ engine: 'chatgpt', brandMentioned: true })]),
    query([answer({ engine: 'chatgpt', error: 'provider unavailable' })]),
    query([answer({ engine: 'chatgpt', brandMentioned: false })]),
  ]
  const rows = deriveEngineSummaries(queries)
  const chatgpt = rows[0]
  assert.equal(chatgpt.available, true)
  assert.equal(chatgpt.attemptedCount, 3)
  assert.equal(chatgpt.answeredCount, 2)
  assert.equal(chatgpt.mentionedCount, 1)
})

test('deriveEngineSummaries: no citation data at all yields 0% coverage, not null, for an available engine', () => {
  const queries = [query([answer({ engine: 'chatgpt', brandMentioned: true, citations: [] })])]
  const rows = deriveEngineSummaries(queries)
  assert.equal(rows[0].citationCoveragePercent, 0)
  assert.equal(rows[0].uniqueCitationDomains, 0)
})

test('deriveEngineSummaries: no competitor data at all yields 0 unique competitors', () => {
  const queries = [query([answer({ engine: 'chatgpt', brandMentioned: true, competitors: [] })])]
  const rows = deriveEngineSummaries(queries)
  assert.equal(rows[0].uniqueCompetitors, 0)
})

test('deriveEngineSummaries: competitor names are de-duplicated case/whitespace-insensitively', () => {
  const queries = [
    query([
      answer({ engine: 'chatgpt', competitors: ['Acme Corp', ' acme corp ', 'Beta Inc'] }),
    ]),
  ]
  const rows = deriveEngineSummaries(queries)
  assert.equal(rows[0].uniqueCompetitors, 2)
})

test('deriveEngineSummaries: a strong engine (high mention rate) gets label Strong', () => {
  const queries = Array.from({ length: 10 }, () => query([answer({ engine: 'chatgpt', brandMentioned: true })]))
  const rows = deriveEngineSummaries(queries)
  assert.equal(rows[0].label, 'Strong')
  assert.equal(rows[0].mentionRate, 100)
})

test('deriveEngineSummaries: a weak engine (low mention rate) gets label Weak, not Not Mentioned', () => {
  const queries = [
    ...Array.from({ length: 1 }, () => query([answer({ engine: 'chatgpt', brandMentioned: true })])),
    ...Array.from({ length: 9 }, () => query([answer({ engine: 'chatgpt', brandMentioned: false })])),
  ]
  const rows = deriveEngineSummaries(queries)
  assert.equal(rows[0].label, 'Weak')
})

test('deriveEngineSummaries: average position is the mean of only the non-null positions', () => {
  const queries = [
    query([answer({ engine: 'chatgpt', brandMentioned: true, brandPosition: 1 })]),
    query([answer({ engine: 'chatgpt', brandMentioned: true, brandPosition: 3 })]),
    query([answer({ engine: 'chatgpt', brandMentioned: true, brandPosition: null })]),
  ]
  const rows = deriveEngineSummaries(queries)
  assert.equal(rows[0].avgPosition, 2)
})

test('deriveEngineSummaries: average position is null when the brand was never cited by this engine', () => {
  const queries = [query([answer({ engine: 'chatgpt', brandMentioned: true, brandPosition: null })])]
  const rows = deriveEngineSummaries(queries)
  assert.equal(rows[0].avgPosition, null)
})

test('deriveEngineSummaries: returns an empty array when nothing was ever attempted', () => {
  assert.deepEqual(deriveEngineSummaries([query([])]), [])
})

test('engineTagline covers every supported engine with non-empty copy', () => {
  for (const engine of ['chatgpt', 'perplexity', 'claude'] as const) {
    assert.ok(engineTagline(engine).length > 0)
  }
})

function summary(overrides: Partial<EngineSummary>): EngineSummary {
  return {
    engine: 'chatgpt',
    attemptedCount: 10,
    answeredCount: 10,
    mentionedCount: 0,
    mentionRate: 0,
    label: 'Not Mentioned',
    available: true,
    avgPosition: null,
    citationCoveragePercent: 0,
    uniqueCompetitors: 0,
    uniqueCitationDomains: 0,
    ...overrides,
  }
}

test('engineInterpretation never claims data exists for an unavailable engine', () => {
  const text = engineInterpretation(summary({ available: false }))
  assert.match(text, /couldn't retrieve/i)
})

test('engineInterpretation for Strong/Weak/Not Mentioned is distinct, deterministic text', () => {
  const strong = engineInterpretation(summary({ label: 'Strong' }))
  const weak = engineInterpretation(summary({ label: 'Weak', uniqueCompetitors: 2 }))
  const none = engineInterpretation(summary({ label: 'Not Mentioned' }))
  assert.notEqual(strong, weak)
  assert.notEqual(weak, none)
  assert.match(weak, /2 other brands/)
})

test('engineComparisonSummary falls back to a neutral line with fewer than 2 available engines', () => {
  assert.doesNotThrow(() => engineComparisonSummary([]))
  assert.doesNotThrow(() => engineComparisonSummary([summary({})]))
  const text = engineComparisonSummary([summary({ available: false })])
  assert.ok(text.length > 0)
})

test('engineComparisonSummary names the best and worst engine by mention rate', () => {
  const text = engineComparisonSummary([
    summary({ engine: 'chatgpt', mentionRate: 90 }),
    summary({ engine: 'claude', mentionRate: 10 }),
  ])
  assert.match(text, /ChatGPT/)
  assert.match(text, /Claude/)
})

test('engineComparisonSummary reports a tie without naming a false winner', () => {
  const text = engineComparisonSummary([
    summary({ engine: 'chatgpt', mentionRate: 50 }),
    summary({ engine: 'claude', mentionRate: 50 }),
  ])
  assert.match(text, /similar/i)
})
