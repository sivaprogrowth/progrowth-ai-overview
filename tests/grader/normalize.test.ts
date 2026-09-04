import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGraderInput, normalizeDomain, isPrivateIpv4, isPrivateIpv6, FIELD_LIMITS } from '../../lib/grader/normalize'

const validBody = {
  domain: 'example.com',
  companyName: 'Acme Insurance',
  industry: 'Insurance',
  service: 'Commercial Insurance',
  location: 'Texas',
}

test('normalizeDomain strips protocol, www, path, trailing slash', () => {
  for (const raw of ['https://www.example.com/', 'http://example.com', 'www.example.com', 'example.com/']) {
    const result = normalizeDomain(raw)
    assert.ok('host' in result, `expected host for ${raw}`)
    assert.equal((result as any).host, 'example.com')
  }
})

test('normalizeDomain lowercases and strips port/credentials', () => {
  const result = normalizeDomain('User:pass@Example.COM:8080/path')
  assert.ok('host' in result)
  assert.equal((result as any).host, 'example.com')
})

test('normalizeDomain rejects localhost and loopback', () => {
  for (const raw of ['localhost', 'http://localhost:3000', '127.0.0.1', 'http://127.0.0.1']) {
    const result = normalizeDomain(raw)
    assert.ok('error' in result, `expected rejection for ${raw}`)
  }
})

test('normalizeDomain rejects private/link-local IPv4 ranges', () => {
  assert.equal(isPrivateIpv4('10.0.0.1'), true)
  assert.equal(isPrivateIpv4('172.16.0.1'), true)
  assert.equal(isPrivateIpv4('192.168.1.1'), true)
  assert.equal(isPrivateIpv4('169.254.169.254'), true) // cloud metadata
  assert.equal(isPrivateIpv4('8.8.8.8'), false)
})

test('normalizeDomain rejects private IPv6', () => {
  assert.equal(isPrivateIpv6('::1'), true)
  assert.equal(isPrivateIpv6('fe80::1'), true)
  assert.equal(isPrivateIpv6('fc00::1'), true)
})

test('normalizeDomain rejects dangerous schemes', () => {
  const result = normalizeDomain('javascript:alert(1)')
  assert.ok('error' in result)
  const result2 = normalizeDomain('file:///etc/passwd')
  assert.ok('error' in result2)
})

test('normalizeDomain rejects malformed domains', () => {
  for (const raw of ['not-a-domain', 'example', '...', 'ex ample.com']) {
    const result = normalizeDomain(raw)
    assert.ok('error' in result, `expected rejection for "${raw}"`)
  }
})

test('normalizeGraderInput accepts a fully valid body', () => {
  const result = normalizeGraderInput(validBody)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.domain, 'example.com')
    assert.equal(result.value.companyName, 'Acme Insurance')
    assert.equal(result.value.homepageUrl, 'https://example.com')
  }
})

test('normalizeGraderInput requires domain, companyName, industry', () => {
  const result = normalizeGraderInput({ companyName: 'Acme', industry: 'Insurance' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === 'domain'))
  }
})

test('normalizeGraderInput treats service/location as optional', () => {
  const result = normalizeGraderInput({ domain: 'example.com', companyName: 'Acme', industry: 'Insurance' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.service, null)
    assert.equal(result.value.location, null)
  }
})

test('normalizeGraderInput rejects an empty company name', () => {
  const result = normalizeGraderInput({ ...validBody, companyName: '' })
  assert.equal(result.ok, false)
})

test('normalizeGraderInput enforces field length caps', () => {
  const result = normalizeGraderInput({
    ...validBody,
    companyName: 'x'.repeat(FIELD_LIMITS.companyName + 1),
  })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.issues.some((i) => i.field === 'companyName'))
  }
})

test('normalizeGraderInput rejects a very long industry field', () => {
  const result = normalizeGraderInput({ ...validBody, industry: 'x'.repeat(1000) })
  assert.equal(result.ok, false)
})

test('normalizeGraderInput rejects a non-object body', () => {
  const result = normalizeGraderInput('not-a-domain')
  assert.equal(result.ok, false)
})
