import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-shape regression guards for the Phase 1 performance work, same
 * approach as tests/grader/root-redirect.test.ts and
 * tests/grader/report-no-gate.test.ts: lib/grader/analyzer.ts drives live
 * DataForSEO + website fetches end to end, so there is no committed mock
 * harness to unit-test it against directly (matching this repo's existing
 * "no new testing dependency" stance). What CAN be verified without one is
 * that the parallelization change is actually structural, not cosmetic —
 * and that the status/warning semantics Phase 3 established are still
 * textually intact after Phase 1's reshuffle.
 */
const ROOT = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('readiness is initiated before the DataForSEO fan-out starts, not after', () => {
  const source = read('lib/grader/analyzer.ts')
  const readinessCallIdx = source.indexOf('auditGraderReadiness(input.homepageUrl, matcher)')
  const fanOutCallIdx = source.indexOf('fetchAllGraderAnswers(')
  assert.ok(readinessCallIdx >= 0, 'expected an auditGraderReadiness(...) call')
  assert.ok(fanOutCallIdx >= 0, 'expected a fetchAllGraderAnswers(...) call')
  assert.ok(
    readinessCallIdx < fanOutCallIdx,
    'readiness must be initiated before the fan-out call for the two to actually overlap'
  )
})

test('the readiness promise is guarded with .catch() at creation, not only at its await site', () => {
  const source = read('lib/grader/analyzer.ts')
  assert.match(
    source,
    /auditGraderReadiness\(input\.homepageUrl, matcher\)\s*\.catch\(/,
    'a secondary readiness failure must never be able to reject the branch it lives on'
  )
})

test('the DataForSEO fan-out concurrency is read from the centralized config helper, not hardcoded', () => {
  const source = read('lib/grader/analyzer.ts')
  assert.match(source, /getGraderProviderConcurrency\(\)/)
  assert.doesNotMatch(
    source,
    /const ANSWER_CONCURRENCY\s*=\s*\d+/,
    'the old hardcoded concurrency constant should be gone, not just unused'
  )
})

test('the 230s answer-fan-out deadline is unchanged', () => {
  const source = read('lib/grader/analyzer.ts')
  assert.match(source, /ANSWER_DEADLINE_MS\s*=\s*230_000/)
})

test('failed status is still triggered ONLY by zero successful engine answers', () => {
  const source = read('lib/grader/analyzer.ts')
  assert.match(source, /succeeded\.length === 0/)
  assert.match(source, /status:\s*'failed'/)
})

test('partial-vs-completed status formula is textually unchanged from before Phase 1', () => {
  const source = read('lib/grader/analyzer.ts')
  assert.match(
    source,
    /failedAnswers > 0 \|\| readiness\.status !== 'ok' \|\| sentiment\.error \? 'partial' : 'completed'/
  )
})

test('per-query rollup, citations, and competitor extraction all still run over the same answers array used for the failed-run check', () => {
  const source = read('lib/grader/analyzer.ts')
  assert.match(source, /buildQueryResults\(queryPlan\.queries, answers, matcher\)/)
  assert.match(source, /aggregateCitations\(answers, matcher\)/)
  assert.match(source, /aggregateCompetitors\(answers, brandMentionCount\)/)
})

test('every major stage is wrapped in a [grader:timing] helper', () => {
  const source = read('lib/grader/analyzer.ts')
  for (const stage of [
    'query-generation',
    'dataforseo-fanout',
    'query-rollup',
    'citation-aggregation',
    'competitor-extraction',
    'sentiment',
    'scoring',
    'recommendations',
    'summary',
  ]) {
    assert.ok(source.includes(`'${stage}'`), `expected a timed stage named '${stage}'`)
  }
})

test('engine-level timing stats are logged but never attached to the persisted/public report shape', () => {
  const analyzerSource = read('lib/grader/analyzer.ts')
  assert.match(analyzerSource, /engineStats/)
  assert.match(analyzerSource, /console\.log\(\s*`\[grader:timing\] reportId=\$\{reportId\} stage=engine-/)

  const typesSource = read('lib/grader/types.ts')
  assert.doesNotMatch(typesSource, /engineStats|EngineCallStats/, 'timing internals must not enter the report type')

  const publicReportSource = read('lib/grader/public-report.ts')
  assert.doesNotMatch(publicReportSource, /engineStats|EngineCallStats|durationMs|fastestMs/)
})

// Phase 3 audit finding: the "zero successful engine answers" failure path
// used to interpolate the raw per-engine error text directly into the
// value returned here, which becomes BOTH the persisted `error_message`
// column AND (unsanitized) GET /api/grader/report/[id]'s public `error`
// field, rendered verbatim by ReportView.tsx's failed-status page. Fixed
// to always return a fixed, safe string; the real reason is still fully
// visible server-side via console.error.
test('the all-engines-failed path never returns raw per-engine error text as the public/persisted error', () => {
  const source = read('lib/grader/analyzer.ts')
  assert.doesNotMatch(
    source,
    /error:\s*`Analysis could not be completed:\s*\$\{sampleError\}`/,
    'the failed-run error must not interpolate raw provider/engine error text'
  )
  assert.match(source, /console\.error\(`\[grader\/analyzer\][^`]*\$\{sampleError\}/, 'the real reason must still be logged server-side')
  assert.match(source, /error:\s*'We could not complete this analysis\. Please try again in a moment\.'/)
})
