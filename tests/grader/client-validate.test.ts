import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateGraderForm, type GraderFormState } from '../../lib/grader/client-validate'

const valid: GraderFormState = {
  domain: 'example.com',
  companyName: 'Acme Insurance',
  industry: 'Insurance',
  service: 'Commercial Insurance',
  location: 'Texas',
}

test('validateGraderForm accepts a fully valid form', () => {
  assert.deepEqual(validateGraderForm(valid), {})
})

test('validateGraderForm accepts optional fields left blank', () => {
  const errors = validateGraderForm({ ...valid, service: '', location: '' })
  assert.deepEqual(errors, {})
})

test('validateGraderForm flags an empty required field', () => {
  const errors = validateGraderForm({ ...valid, companyName: '' })
  assert.equal(errors.companyName, 'Please enter your company name')
})

test('validateGraderForm flags a malformed domain the same way the server would reject it', () => {
  const errors = validateGraderForm({ ...valid, domain: 'not a domain' })
  assert.ok(errors.domain)
})

test('validateGraderForm flags localhost/private domains (reuses server SSRF rules)', () => {
  const errors = validateGraderForm({ ...valid, domain: 'localhost' })
  assert.ok(errors.domain)
})

test('validateGraderForm flags an oversized field', () => {
  const errors = validateGraderForm({ ...valid, companyName: 'x'.repeat(200) })
  assert.ok(errors.companyName?.includes('150'))
})

test('validateGraderForm returns multiple errors at once, not just the first', () => {
  const errors = validateGraderForm({ domain: '', companyName: '', industry: '', service: '', location: '' })
  assert.ok(errors.domain)
  assert.ok(errors.companyName)
  assert.ok(errors.industry)
})
