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
  aggregateEnginePresence,
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

test('aggregateEnginePresence counts per engine, excluding failed calls', () => {
  const queries = [
    query([
      answer({ engine: 'chatgpt', brandMentioned: true }),
      answer({ engine: 'perplexity', brandMentioned: false }),
      answer({ engine: 'claude', error: 'timeout' }),
    ]),
    query([
      answer({ engine: 'chatgpt', brandMentioned: false }),
      answer({ engine: 'perplexity', brandMentioned: true }),
    ]),
  ]
  const rows = aggregateEnginePresence(queries)
  const chatgpt = rows.find((r) => r.engine === 'chatgpt')!
  const perplexity = rows.find((r) => r.engine === 'perplexity')!
  const claude = rows.find((r) => r.engine === 'claude')

  assert.equal(chatgpt.answeredCount, 2)
  assert.equal(chatgpt.mentionedCount, 1)
  assert.equal(perplexity.answeredCount, 2)
  assert.equal(perplexity.mentionedCount, 1)
  // claude only ever errored — zero successful answers, so it should not
  // appear as a row at all (nothing to report).
  assert.equal(claude, undefined)
})

test('aggregateEnginePresence returns rows in a fixed, stable engine order', () => {
  const queries = [
    query([answer({ engine: 'claude', brandMentioned: true }), answer({ engine: 'chatgpt', brandMentioned: true })]),
  ]
  const rows = aggregateEnginePresence(queries)
  assert.deepEqual(rows.map((r) => r.engine), ['chatgpt', 'claude'])
})

test('aggregateEnginePresence returns an empty array when nothing answered', () => {
  assert.deepEqual(aggregateEnginePresence([query([])]), [])
})
