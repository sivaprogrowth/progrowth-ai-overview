import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { middleware } from '../../middleware'

/** True when the middleware let the request continue (NextResponse.next()). */
function isPassThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1'
}

function requestTo(path: string, init?: { headers?: Record<string, string> }): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, init)
}

test('POST /api/grader/analyze is public with no auth at all', async () => {
  const res = await middleware(requestTo('/api/grader/analyze'))
  assert.equal(isPassThrough(res), true)
})

test('GET /api/grader/report/[id] is public with no auth at all', async () => {
  const res = await middleware(requestTo('/api/grader/report/11111111-1111-1111-1111-111111111111'))
  assert.equal(isPassThrough(res), true)
})

test('POST /api/grader/lead is public with no auth at all', async () => {
  const res = await middleware(requestTo('/api/grader/lead'))
  assert.equal(isPassThrough(res), true)
})

test('the grader allowlist is an exact/prefix match, not a broad /api/grader/ prefix', async () => {
  // A hypothetical future internal grader route must NOT be swept into the
  // public allowlist just because it starts with /api/grader/.
  const res = await middleware(requestTo('/api/grader/admin'))
  assert.equal(isPassThrough(res), false)
  assert.equal(res.status, 401)
})

test('internal analysis API stays protected with no session', async () => {
  const res = await middleware(requestTo('/api/analyze'))
  assert.equal(isPassThrough(res), false)
  assert.equal(res.status, 401)
})

test('internal client/admin-style APIs stay protected with no session', async () => {
  for (const path of ['/api/clients', '/api/scorecard', '/api/analyses', '/api/matomo/kpi']) {
    const res = await middleware(requestTo(path))
    assert.equal(isPassThrough(res), false, `${path} should not pass through`)
    assert.equal(res.status, 401, `${path} should 401`)
  }
})

test('cron routes reject a missing or wrong Bearer token', async () => {
  const noAuth = await middleware(requestTo('/api/cron/matomo-analysis'))
  assert.equal(isPassThrough(noAuth), false)
  assert.equal(noAuth.status, 401)

  const wrongAuth = await middleware(
    requestTo('/api/cron/matomo-analysis', { headers: { authorization: 'Bearer wrong-token' } })
  )
  assert.equal(isPassThrough(wrongAuth), false)
  assert.equal(wrongAuth.status, 401)
})

test('cron routes accept the configured CRON_SECRET Bearer token', async () => {
  const saved = process.env.CRON_SECRET
  process.env.CRON_SECRET = 'test-cron-secret'
  try {
    const res = await middleware(
      requestTo('/api/cron/matomo-analysis', { headers: { authorization: 'Bearer test-cron-secret' } })
    )
    assert.equal(isPassThrough(res), true)
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = saved
  }
})

test('auth routes are public with no session (needed to log in at all)', async () => {
  const res = await middleware(requestTo('/api/auth/send-otp'))
  assert.equal(isPassThrough(res), true)
})

test('page routes pass through regardless of session (client-side gating)', async () => {
  const res = await middleware(requestTo('/'))
  assert.equal(isPassThrough(res), true)
})
