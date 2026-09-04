import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Source-shape regression guards, same approach as
 * tests/grader/analyzer-perf.test.ts and tests/grader/root-redirect.test.ts:
 * the two protected routes call into real Supabase/DataForSEO once past
 * their guards, so there is no committed mock harness to unit-test their
 * full request/response cycle against directly (this repo's established
 * "no new testing dependency" stance). What CAN be verified without one
 * is that the auth guard is actually wired in, and wired in EARLY — before
 * any expensive or Supabase-touching work, matching Phase 9's requirement
 * that unauthorized callers can never trigger paid provider calls.
 *
 * lib/grader/api-auth.ts's own behavior (missing header, invalid scheme,
 * wrong token, correct token, missing server key) is covered directly and
 * thoroughly in tests/grader/api-auth.test.ts — this file only confirms
 * the two routes actually call it, in the right order.
 */
const ROOT = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('POST /api/grader/analyze calls the auth guard before assertGraderEnv or any paid work', () => {
  const source = read('app/api/grader/analyze/route.ts')
  assert.match(source, /import \{ requireValidProelevateAuthOrPublic \} from '@\/lib\/grader\/api-auth'/)

  const authCallIdx = source.indexOf('requireValidProelevateAuthOrPublic(req.headers)')
  const envCallIdx = source.indexOf('assertGraderEnv()')
  const runAnalysisIdx = source.indexOf('runGraderAnalysis(')
  assert.ok(authCallIdx >= 0, 'expected a requireValidProelevateAuthOrPublic(req.headers) call')
  assert.ok(authCallIdx < envCallIdx, 'auth must be checked before the env assertion')
  assert.ok(authCallIdx < runAnalysisIdx, 'auth must be checked before the paid analysis runs')

  // The guard must actually short-circuit — `if (authError) return authError`
  // right after the call, not merely be invoked and ignored.
  const guardBlock = source.slice(authCallIdx, authCallIdx + 200)
  assert.match(guardBlock, /if \(authError\) return authError/)
})

test('GET /api/grader/report/[id] calls the auth guard before the Supabase lookup', () => {
  const source = read('app/api/grader/report/[id]/route.ts')
  assert.match(source, /import \{ requireValidProelevateAuthOrPublic \} from '@\/lib\/grader\/api-auth'/)

  const authCallIdx = source.indexOf('requireValidProelevateAuthOrPublic(req.headers)')
  const lookupIdx = source.indexOf('getGraderRun(id)')
  assert.ok(authCallIdx >= 0, 'expected a requireValidProelevateAuthOrPublic(req.headers) call')
  assert.ok(authCallIdx < lookupIdx, 'auth must be checked before the Supabase lookup')

  const guardBlock = source.slice(authCallIdx, authCallIdx + 200)
  assert.match(guardBlock, /if \(authError\) return authError/)
})

test('POST /api/grader/lead is left untouched — no auth import, unchanged public behavior', () => {
  const source = read('app/api/grader/lead/route.ts')
  assert.doesNotMatch(source, /api-auth/)
})

test('the auth utility never appears anywhere in the public report sanitizer or the grading engine', () => {
  // This task adds an authentication BOUNDARY around the existing API — it
  // must not have touched the grading logic itself.
  for (const file of ['lib/grader/scoring.ts', 'lib/grader/analyzer.ts', 'lib/grader/public-report.ts']) {
    assert.doesNotMatch(read(file), /api-auth/, `${file} should not reference the auth utility`)
  }
})
