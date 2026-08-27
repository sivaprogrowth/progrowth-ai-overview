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
