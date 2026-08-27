import { test } from 'node:test'
import assert from 'node:assert/strict'
import dns from 'node:dns'
import { isSafeHostToFetch } from '../../lib/grader/ssrf-guard'

test('isSafeHostToFetch rejects a private IPv4 literal without any DNS lookup', async (t) => {
  const lookupSpy = t.mock.method(dns.promises, 'lookup')
  const result = await isSafeHostToFetch('192.168.1.1')
  assert.equal(result.safe, false)
  assert.equal(lookupSpy.mock.callCount(), 0)
})

test('isSafeHostToFetch rejects loopback and link-local literals', async () => {
  assert.equal((await isSafeHostToFetch('127.0.0.1')).safe, false)
  assert.equal((await isSafeHostToFetch('169.254.169.254')).safe, false)
  assert.equal((await isSafeHostToFetch('::1')).safe, false)
})

test('isSafeHostToFetch accepts a public IPv4 literal without a DNS lookup', async (t) => {
  const lookupSpy = t.mock.method(dns.promises, 'lookup')
  const result = await isSafeHostToFetch('8.8.8.8')
  assert.equal(result.safe, true)
  assert.equal(lookupSpy.mock.callCount(), 0)
})

test('isSafeHostToFetch resolves a hostname and rejects it if DNS points at a private address', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '10.0.0.5', family: 4 }])
  const result = await isSafeHostToFetch('internal.example.com')
  assert.equal(result.safe, false)
  assert.ok(result.reason?.includes('private'))
})

test('isSafeHostToFetch accepts a hostname that resolves to a public address', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }])
  const result = await isSafeHostToFetch('example.com')
  assert.equal(result.safe, true)
})

test('isSafeHostToFetch rejects a hostname whose DNS lookup fails (fail closed)', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => {
    throw new Error('ENOTFOUND')
  })
  const result = await isSafeHostToFetch('does-not-resolve.invalid')
  assert.equal(result.safe, false)
})

test('isSafeHostToFetch rejects a hostname with no resolved addresses at all', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [])
  const result = await isSafeHostToFetch('no-records.example.com')
  assert.equal(result.safe, false)
})

test('isSafeHostToFetch rejects when ANY resolved address (not just the first) is private', async (t) => {
  t.mock.method(dns.promises, 'lookup', async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ])
  const result = await isSafeHostToFetch('mixed.example.com')
  assert.equal(result.safe, false)
})
