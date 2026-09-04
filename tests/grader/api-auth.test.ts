import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkProelevateAuth, requireValidProelevateAuthOrPublic } from '../../lib/grader/api-auth'

function headersWith(authorization?: string): Headers {
  const h = new Headers()
  if (authorization !== undefined) h.set('authorization', authorization)
  return h
}

function withKey<T>(key: string | undefined, fn: () => T): T {
  const saved = process.env.PROELEVATE_API_KEY
  if (key === undefined) delete process.env.PROELEVATE_API_KEY
  else process.env.PROELEVATE_API_KEY = key
  try {
    return fn()
  } finally {
    if (saved === undefined) delete process.env.PROELEVATE_API_KEY
    else process.env.PROELEVATE_API_KEY = saved
  }
}

test('checkProelevateAuth: missing Authorization header is unauthenticated, not invalid', () => {
  withKey('secret-123', () => {
    assert.equal(checkProelevateAuth(headersWith()), 'unauthenticated')
  })
})

test('checkProelevateAuth: missing header is unauthenticated even when no server key is configured', () => {
  // This is the exact situation the live public grader website is in
  // today — no header, and (until PROELEVATE_API_KEY is first configured)
  // no server key either. It must never be treated as an auth failure.
  withKey(undefined, () => {
    assert.equal(checkProelevateAuth(headersWith()), 'unauthenticated')
  })
})

test('checkProelevateAuth: non-Bearer scheme is invalid', () => {
  withKey('secret-123', () => {
    assert.equal(checkProelevateAuth(headersWith('Basic dXNlcjpwYXNz')), 'invalid')
  })
})

test('checkProelevateAuth: "Bearer" with no token is invalid', () => {
  withKey('secret-123', () => {
    assert.equal(checkProelevateAuth(headersWith('Bearer')), 'invalid')
    assert.equal(checkProelevateAuth(headersWith('Bearer   ')), 'invalid')
  })
})

test('checkProelevateAuth: wrong token is invalid', () => {
  withKey('secret-123', () => {
    assert.equal(checkProelevateAuth(headersWith('Bearer wrong-token')), 'invalid')
  })
})

test('checkProelevateAuth: correct token is authenticated', () => {
  withKey('secret-123', () => {
    assert.equal(checkProelevateAuth(headersWith('Bearer secret-123')), 'authenticated')
  })
})

test('checkProelevateAuth: Bearer scheme match is case-insensitive, token comparison is not', () => {
  withKey('secret-123', () => {
    assert.equal(checkProelevateAuth(headersWith('bearer secret-123')), 'authenticated')
    assert.equal(checkProelevateAuth(headersWith('BEARER secret-123')), 'authenticated')
    assert.equal(checkProelevateAuth(headersWith('Bearer Secret-123')), 'invalid')
  })
})

test('checkProelevateAuth: a presented token is invalid when no server key is configured (fails closed)', () => {
  withKey(undefined, () => {
    assert.equal(checkProelevateAuth(headersWith('Bearer anything-at-all')), 'invalid')
  })
})

test('checkProelevateAuth: tokens of different lengths are still safely rejected, not thrown', () => {
  withKey('a-much-longer-secret-value-than-the-guess', () => {
    assert.doesNotThrow(() => checkProelevateAuth(headersWith('Bearer x')))
    assert.equal(checkProelevateAuth(headersWith('Bearer x')), 'invalid')
  })
})

test('requireValidProelevateAuthOrPublic: returns null (proceed) with no header', () => {
  withKey('secret-123', () => {
    assert.equal(requireValidProelevateAuthOrPublic(headersWith()), null)
  })
})

test('requireValidProelevateAuthOrPublic: returns null (proceed) with a correct token', () => {
  withKey('secret-123', () => {
    assert.equal(requireValidProelevateAuthOrPublic(headersWith('Bearer secret-123')), null)
  })
})

test('requireValidProelevateAuthOrPublic: returns a 401 with a wrong token', async () => {
  withKey('secret-123', () => {
    const res = requireValidProelevateAuthOrPublic(headersWith('Bearer wrong'))
    assert.ok(res)
    assert.equal(res!.status, 401)
  })
})

test('requireValidProelevateAuthOrPublic: the 401 body never echoes the provided or expected token', async () => {
  await withKey('super-secret-value', async () => {
    const res = requireValidProelevateAuthOrPublic(headersWith('Bearer someone-guessed-this'))
    assert.ok(res)
    const body = await res!.json()
    const text = JSON.stringify(body)
    assert.doesNotMatch(text, /super-secret-value/)
    assert.doesNotMatch(text, /someone-guessed-this/)
    assert.deepEqual(body, { error: 'Unauthorized' })
  })
})
