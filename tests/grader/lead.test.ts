import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLeadInput } from '../../lib/grader/lead'

const valid = { reportId: '11111111-1111-1111-1111-111111111111', name: 'Jane Doe', email: 'jane@example.com' }

test('normalizeLeadInput accepts a valid lead', () => {
  const result = normalizeLeadInput(valid)
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.email, 'jane@example.com')
    assert.equal(result.value.name, 'Jane Doe')
  }
})

test('normalizeLeadInput lowercases email', () => {
  const result = normalizeLeadInput({ ...valid, email: 'Jane@EXAMPLE.com' })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.email, 'jane@example.com')
})

test('normalizeLeadInput requires reportId, name, and email', () => {
  const result = normalizeLeadInput({ reportId: '', name: '', email: '' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    const fields = result.issues.map((i) => i.field)
    assert.ok(fields.includes('reportId'))
    assert.ok(fields.includes('name'))
    assert.ok(fields.includes('email'))
  }
})

test('normalizeLeadInput rejects a malformed email', () => {
  const result = normalizeLeadInput({ ...valid, email: 'not-an-email' })
  assert.equal(result.ok, false)
})

test('normalizeLeadInput rejects an oversized name', () => {
  const result = normalizeLeadInput({ ...valid, name: 'x'.repeat(200) })
  assert.equal(result.ok, false)
})

test('normalizeLeadInput rejects a non-object body', () => {
  const result = normalizeLeadInput('not-an-object')
  assert.equal(result.ok, false)
})

test('normalizeLeadInput rejects an oversized email', () => {
  const result = normalizeLeadInput({ ...valid, email: `${'x'.repeat(250)}@example.com` })
  assert.equal(result.ok, false)
})
