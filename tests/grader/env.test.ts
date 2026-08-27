import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertGraderEnv, GraderEnvError } from '../../lib/grader/env'

const REQUIRED = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD']

function withEnv(overrides: Record<string, string | undefined>, fn: () => void) {
  const saved: Record<string, string | undefined> = {}
  for (const key of REQUIRED) saved[key] = process.env[key]
  try {
    for (const key of REQUIRED) {
      if (overrides[key] === undefined) delete process.env[key]
      else process.env[key] = overrides[key]
    }
    fn()
  } finally {
    for (const key of REQUIRED) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

test('assertGraderEnv passes when all required vars are set', () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: 'x' },
    () => assert.doesNotThrow(() => assertGraderEnv())
  )
})

test('assertGraderEnv throws GraderEnvError listing every missing variable', () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: undefined, DATAFORSEO_LOGIN: undefined, DATAFORSEO_PASSWORD: 'x' },
    () => {
      assert.throws(() => assertGraderEnv(), (e: unknown) => {
        assert.ok(e instanceof GraderEnvError)
        assert.deepEqual(e.missing, ['SUPABASE_SERVICE_ROLE_KEY', 'DATAFORSEO_LOGIN'])
        return true
      })
    }
  )
})

test('assertGraderEnv error message never contains a real secret value', () => {
  withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', DATAFORSEO_LOGIN: 'x', DATAFORSEO_PASSWORD: undefined },
    () => {
      try {
        assertGraderEnv()
        assert.fail('expected assertGraderEnv to throw')
      } catch (e) {
        assert.ok(e instanceof Error)
        assert.ok(e.message.includes('DATAFORSEO_PASSWORD'))
        assert.ok(!e.message.includes('=x'))
      }
    }
  )
})
