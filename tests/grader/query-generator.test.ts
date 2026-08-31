import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateTemplateQueries,
  parseLlmQueries,
  generateQueries,
  MIN_QUERIES,
  MAX_QUERIES,
} from '../../lib/grader/query-generator'
import type { NormalizedGraderInput } from '../../lib/grader/types'

const input: NormalizedGraderInput = {
  domain: 'acmeinsurance.com',
  companyName: 'Acme Insurance',
  industry: 'Insurance',
  service: 'Commercial Insurance',
  location: 'Texas',
  homepageUrl: 'https://acmeinsurance.com',
}

test('generateTemplateQueries produces between MIN and MAX queries', () => {
  const queries = generateTemplateQueries(input)
  assert.ok(queries.length >= MIN_QUERIES, `expected >= ${MIN_QUERIES}, got ${queries.length}`)
  assert.ok(queries.length <= MAX_QUERIES)
})

test('generateTemplateQueries covers all four categories', () => {
  const queries = generateTemplateQueries(input)
  const categories = new Set(queries.map((q) => q.category))
  assert.deepEqual(
    categories,
    new Set(['category_discovery', 'recommendation_intent', 'brand_evaluation', 'alternatives_comparison'])
  )
})

test('generateTemplateQueries is deterministic for the same input', () => {
  const a = generateTemplateQueries(input)
  const b = generateTemplateQueries(input)
  assert.deepEqual(a, b)
})

test('generateTemplateQueries has no duplicate query text', () => {
  const queries = generateTemplateQueries(input)
  const texts = queries.map((q) => q.query.toLowerCase())
  assert.equal(new Set(texts).size, texts.length)
})

test('generateTemplateQueries incorporates location and company name', () => {
  const queries = generateTemplateQueries(input)
  assert.ok(queries.some((q) => q.query.includes('Texas')))
  assert.ok(queries.some((q) => q.query.includes('Acme Insurance')))
})

test('generateTemplateQueries falls back to industry when service is absent', () => {
  const noService: NormalizedGraderInput = { ...input, service: null }
  const queries = generateTemplateQueries(noService)
  assert.ok(queries.some((q) => q.query.includes('Insurance')))
})

test('every generated query has a valid category/priority/source', () => {
  const queries = generateTemplateQueries(input)
  for (const q of queries) {
    assert.ok(['category_discovery', 'recommendation_intent', 'brand_evaluation', 'alternatives_comparison'].includes(q.category))
    assert.ok(['high', 'medium', 'low'].includes(q.priority))
    assert.equal(q.source, 'template')
  }
})

test('parseLlmQueries parses a JSON array', () => {
  const result = parseLlmQueries('["What is the best provider?", "How do I compare options?"]')
  assert.deepEqual(result, ['What is the best provider?', 'How do I compare options?'])
})

test('parseLlmQueries parses a numbered/bulleted list', () => {
  const result = parseLlmQueries('1. What is the best provider?\n2. How do I compare options?\n- A third question here')
  assert.equal(result.length, 3)
})

test('parseLlmQueries returns empty for empty input', () => {
  assert.deepEqual(parseLlmQueries(''), [])
})

test('generateQueries never touches the network when GRADER_LLM_QUERIES is unset (default off)', async () => {
  delete process.env.GRADER_LLM_QUERIES
  const result = await generateQueries(input)
  assert.equal(result.calls, 0)
  assert.equal(result.cost, 0)
  assert.equal(result.warning, null)
  assert.ok(result.queries.length <= MAX_QUERIES)
})

// Phase 2: query-count is now configurable (lib/grader/query-count.ts).
// These lock in the exact category split at each size, since that split —
// not just the raw count — is what the Phase 2 report's recommendation
// (8, not 10) actually rests on.

function categoryCounts(queries: { category: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const q of queries) counts[q.category] = (counts[q.category] ?? 0) + 1
  return counts
}

test('generateTemplateQueries(targetCount=8) splits evenly 2/2/2/2 across all four categories', () => {
  const queries = generateTemplateQueries(input, 8)
  assert.equal(queries.length, 8)
  assert.deepEqual(categoryCounts(queries), {
    category_discovery: 2,
    recommendation_intent: 2,
    brand_evaluation: 2,
    alternatives_comparison: 2,
  })
})

test('generateTemplateQueries(targetCount=10) splits unevenly 3/3/2/2 (high-priority categories favored)', () => {
  const queries = generateTemplateQueries(input, 10)
  assert.equal(queries.length, 10)
  assert.deepEqual(categoryCounts(queries), {
    category_discovery: 3,
    recommendation_intent: 3,
    brand_evaluation: 2,
    alternatives_comparison: 2,
  })
})

test('generateTemplateQueries(targetCount=12) matches the original flat 3/3/3/3 split', () => {
  const queries = generateTemplateQueries(input, 12)
  assert.equal(queries.length, 12)
  assert.deepEqual(categoryCounts(queries), {
    category_discovery: 3,
    recommendation_intent: 3,
    brand_evaluation: 3,
    alternatives_comparison: 3,
  })
})

test("generateTemplateQueries's first N queries are a stable prefix regardless of targetCount", () => {
  const eight = generateTemplateQueries(input, 8)
  const twelve = generateTemplateQueries(input, 12)
  assert.deepEqual(twelve.slice(0, 8), eight)
})

test('generateQueries respects GRADER_QUERY_COUNT', async () => {
  delete process.env.GRADER_LLM_QUERIES
  process.env.GRADER_QUERY_COUNT = '10'
  const result = await generateQueries(input)
  assert.equal(result.queries.length, 10)
  delete process.env.GRADER_QUERY_COUNT
})

test('generateQueries defaults to 8 queries when GRADER_QUERY_COUNT is unset', async () => {
  delete process.env.GRADER_LLM_QUERIES
  delete process.env.GRADER_QUERY_COUNT
  const result = await generateQueries(input)
  assert.equal(result.queries.length, 8)
})
