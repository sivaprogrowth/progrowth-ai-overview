import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Source-shape regression guards, same approach as root-redirect.test.ts:
// this repo deliberately has no React render harness (no new testing
// dependency added for it), so "the gate is gone and stays gone" is
// verified by asserting on the actual component source rather than a
// rendered tree. Run via `npm run test:grader` from the repo root.
const ROOT = process.cwd()

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('EmailGate.tsx no longer exists', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'components/grader/EmailGate.tsx')), false)
})

test('ReportView.tsx no longer imports or renders EmailGate', () => {
  const source = read('components/grader/ReportView.tsx')
  assert.doesNotMatch(source, /EmailGate/)
})

test('ReportView.tsx no longer reads/writes localStorage for report unlock state', () => {
  const source = read('components/grader/ReportView.tsx')
  assert.doesNotMatch(source, /localStorage/)
  assert.doesNotMatch(source, /unlock/i)
})

test('every report section renders unconditionally in ReportView.tsx (not behind an unlock/gate check)', () => {
  const source = read('components/grader/ReportView.tsx')
  // Each of these must appear exactly once as a JSX tag — if a gate were
  // reintroduced, one common pattern is duplicating a "locked" vs
  // "unlocked" branch, which would make one of these appear twice or not
  // at all outside a conditional.
  const sections = [
    '<MultiEngineScorecard',
    '<ScoreBreakdown',
    '<CompetitorShare',
    '<QueryResults',
    '<CitationSources',
    '<ReadinessChecklist',
    '<Recommendations',
    '<ReportCTA',
  ]
  for (const tag of sections) {
    const count = source.split(tag).length - 1
    assert.equal(count, 1, `expected exactly one ${tag} usage, found ${count}`)
  }
})

test('no gate-shaped copy remains anywhere in the grader UI', () => {
  const dir = path.join(ROOT, 'components/grader')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tsx'))
  const bannedPatterns = [/unlock/i, /work email/i, /enter your email/i]
  for (const file of files) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    for (const pattern of bannedPatterns) {
      assert.doesNotMatch(source, pattern, `${file} should not match ${pattern}`)
    }
  }
})

test('ReportCTA is still imported and used by ReportView (the report still ends with a conversion CTA)', () => {
  const source = read('components/grader/ReportView.tsx')
  assert.match(source, /import\s*\{\s*ReportCTA\s*\}\s*from\s*['"]\.\/ReportCTA['"]/)
  assert.match(source, /<ReportCTA\s*\/>/)
})

test('the lead API route and migration 007 are left in place (backend infra retained, not deleted)', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'app/api/grader/lead/route.ts')), true)
  assert.equal(fs.existsSync(path.join(ROOT, 'migrations/007_grader_lead_capture.sql')), true)
})
