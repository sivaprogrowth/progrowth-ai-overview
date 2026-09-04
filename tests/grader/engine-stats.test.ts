import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeEngineCallStats } from '../../lib/grader/engine-stats'
import type { EngineAnswer, GraderEngine } from '../../lib/grader/types'

/**
 * Pure aggregation over synthetic (already-collected) call data — no fetch,
 * no timers, no flakiness. Exercises the per-engine reliability/latency
 * math the Phase 1 performance investigation reads directly (attempted vs
 * succeeded vs failed, fastest/slowest/avg, wall-clock span).
 */

function answer(engine: GraderEngine, error: string | null = null): EngineAnswer {
  return {
    query: 'q',
    engine,
    answerText: error ? '' : 'some answer',
    brandMentioned: false,
    brandPosition: null,
    competitors: [],
    citations: [],
    costUsd: null,
    error,
  }
}

test('summarizeEngineCallStats counts attempted/succeeded/failed per engine', () => {
  const pairs = [
    { engine: 'chatgpt' as GraderEngine },
    { engine: 'chatgpt' as GraderEngine },
    { engine: 'perplexity' as GraderEngine },
  ]
  const results = [answer('chatgpt'), answer('chatgpt', 'provider call failed'), answer('perplexity')]
  const timings = [
    { engine: 'chatgpt' as GraderEngine, startedAt: 0, finishedAt: 100 },
    { engine: 'chatgpt' as GraderEngine, startedAt: 0, finishedAt: 200 },
    { engine: 'perplexity' as GraderEngine, startedAt: 0, finishedAt: 50 },
  ]
  const stats = summarizeEngineCallStats(pairs, results, timings, ['chatgpt', 'perplexity', 'claude'])

  const chatgpt = stats.find((s) => s.engine === 'chatgpt')!
  assert.equal(chatgpt.attempted, 2)
  assert.equal(chatgpt.succeeded, 1)
  assert.equal(chatgpt.failed, 1)

  const perplexity = stats.find((s) => s.engine === 'perplexity')!
  assert.equal(perplexity.attempted, 1)
  assert.equal(perplexity.succeeded, 1)
  assert.equal(perplexity.failed, 0)

  const claude = stats.find((s) => s.engine === 'claude')!
  assert.equal(claude.attempted, 0)
  assert.equal(claude.succeeded, 0)
  assert.equal(claude.failed, 0)
})

test('summarizeEngineCallStats computes fastest/slowest/avg only over settled calls', () => {
  const pairs = [{ engine: 'claude' as GraderEngine }, { engine: 'claude' as GraderEngine }, { engine: 'claude' as GraderEngine }]
  const results = [answer('claude'), answer('claude'), answer('claude')]
  const timings = [
    { engine: 'claude' as GraderEngine, startedAt: 1000, finishedAt: 1500 }, // 500ms
    { engine: 'claude' as GraderEngine, startedAt: 1000, finishedAt: 3000 }, // 2000ms
    undefined, // never settled before the deadline — excluded from latency stats
  ]
  const stats = summarizeEngineCallStats(pairs, results, timings, ['claude'])
  const claude = stats[0]

  assert.equal(claude.attempted, 3)
  assert.equal(claude.fastestMs, 500)
  assert.equal(claude.slowestMs, 2000)
  assert.equal(claude.avgMs, 1250)
  assert.equal(claude.wallClockSpanMs, 2000) // max(finishedAt) - min(startedAt) = 3000 - 1000
})

test('summarizeEngineCallStats reports null latency fields when every call for an engine timed out', () => {
  const pairs = [{ engine: 'perplexity' as GraderEngine }]
  const results = [answer('perplexity', 'analysis deadline reached before this call completed')]
  const timings = [undefined]
  const stats = summarizeEngineCallStats(pairs, results, timings, ['perplexity'])
  const perplexity = stats[0]

  assert.equal(perplexity.attempted, 1)
  assert.equal(perplexity.succeeded, 0)
  assert.equal(perplexity.failed, 1)
  assert.equal(perplexity.fastestMs, null)
  assert.equal(perplexity.slowestMs, null)
  assert.equal(perplexity.avgMs, null)
  assert.equal(perplexity.wallClockSpanMs, null)
})

test('summarizeEngineCallStats returns one row per requested engine, in the order given', () => {
  const stats = summarizeEngineCallStats([], [], [], ['chatgpt', 'perplexity', 'claude'])
  assert.deepEqual(stats.map((s) => s.engine), ['chatgpt', 'perplexity', 'claude'])
  for (const s of stats) {
    assert.equal(s.attempted, 0)
    assert.equal(s.succeeded, 0)
    assert.equal(s.failed, 0)
  }
})
