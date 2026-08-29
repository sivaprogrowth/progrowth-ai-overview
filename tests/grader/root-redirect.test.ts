import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// NOT path.resolve(__dirname, ...) — at runtime __dirname points inside
// .test-build/tests/grader (the compiled output), not the source tree, so
// that would resolve into .test-build itself. This suite is always run
// via `npm run test:grader` from the repo root (see package.json), so
// process.cwd() is the correct, simple anchor for reading SOURCE files.
const ROOT = process.cwd()

/**
 * app/page.tsx's redirect('/grader') can't be exercised through
 * middleware.test.ts's NextRequest/middleware() harness — the redirect is
 * a Server Component call (next/navigation's redirect()), not middleware
 * logic, and this repo deliberately doesn't pull in a full App Router
 * render harness for one page (see the Phase 2/3 test philosophy: no new
 * heavy testing dependency). This is a source-shape regression guard
 * instead: it fails loudly if a future edit removes the redirect, moves
 * it to a different target, or reintroduces the old internal
 * LoginForm/dashboard content directly at `/`.
 */
function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('app/page.tsx redirects to /grader', () => {
  const source = read('app/page.tsx')
  assert.match(source, /redirect\(\s*['"]\/grader['"]\s*\)/)
  assert.match(source, /from ['"]next\/navigation['"]/)
})

test('app/page.tsx no longer imports/renders the internal LoginForm directly', () => {
  const source = read('app/page.tsx')
  // Checks for an actual import, not just the word appearing in a doc
  // comment explaining where the internal product moved to.
  assert.doesNotMatch(source, /import\s+LoginForm/)
})

test('the internal product entry point moved to app/dashboard/page.tsx', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'app/dashboard/page.tsx')), true)
  const source = read('app/dashboard/page.tsx')
  assert.match(source, /LoginForm/)
})

test('LogoutButton redirects to /dashboard, not the old internal root', () => {
  const source = read('components/LogoutButton.tsx')
  assert.match(source, /window\.location\.href\s*=\s*['"]\/dashboard['"]/)
})

test('internal breadcrumb links point at /dashboard, not the public root', () => {
  for (const file of ['app/clients/page.tsx', 'app/citation-network/page.tsx', 'app/scorecard/page.tsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /href="\/"/, `${file} should not link back to "/"`)
    assert.match(source, /href="\/dashboard"/, `${file} should link back to "/dashboard"`)
  }
})
