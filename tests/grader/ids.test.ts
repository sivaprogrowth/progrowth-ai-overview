import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidReportId } from '../../lib/grader/ids'

test('isValidReportId accepts a well-formed UUID', () => {
  assert.equal(isValidReportId('11111111-1111-1111-1111-111111111111'), true)
  assert.equal(isValidReportId('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'), true)
})

test('isValidReportId rejects malformed ids', () => {
  assert.equal(isValidReportId('not-a-uuid'), false)
  assert.equal(isValidReportId(''), false)
  assert.equal(isValidReportId('11111111-1111-1111-1111'), false)
  assert.equal(isValidReportId(123 as unknown as string), false)
  assert.equal(isValidReportId(null as unknown as string), false)
})
