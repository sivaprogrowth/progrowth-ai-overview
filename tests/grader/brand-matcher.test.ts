import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBrandMatcher, domainStem, bareHost, normalizeBrandName } from '../../lib/grader/brand-matcher'

test('bareHost strips protocol, www, port, trailing dot', () => {
  assert.equal(bareHost('https://www.Example.com:8080/'), 'example.com')
  assert.equal(bareHost('example.com.'), 'example.com')
})

test('domainStem drops the TLD (and 2-part ccTLD)', () => {
  assert.equal(domainStem('acmecorp.com'), 'acmecorp')
  assert.equal(domainStem('acme-corp.co.uk'), 'acme-corp')
})

test('generic single-word brand only matches with a qualifier (no false positive)', () => {
  const matcher = createBrandMatcher({ companyName: 'Progressive', domain: 'progressive.com' })
  assert.equal(matcher.mentionedIn('We offer a progressive approach to claims.'), false)
  assert.equal(matcher.mentionedIn('progressive lenses are popular'), false)
  assert.equal(matcher.mentionedIn('Progressive Insurance is a top provider.'), true)
  assert.equal(matcher.mentionedIn('Visit progressive.com for a quote.'), true)
})

test('multi-word brand name matches directly with flexible whitespace', () => {
  const matcher = createBrandMatcher({ companyName: 'Acme Insurance', domain: 'acmeinsurance.com' })
  assert.equal(matcher.mentionedIn('Acme Insurance offers great rates.'), true)
  assert.equal(matcher.mentionedIn('Acme  Insurance offers great rates.'), true)
  assert.equal(matcher.mentionedIn('We recommend a different provider.'), false)
})

test('ownsDomain matches exact host and subdomains only', () => {
  const matcher = createBrandMatcher({ companyName: 'Acme', domain: 'acme.com' })
  assert.equal(matcher.ownsDomain('acme.com'), true)
  assert.equal(matcher.ownsDomain('www.acme.com'), true)
  assert.equal(matcher.ownsDomain('blog.acme.com'), true)
  assert.equal(matcher.ownsDomain('notacme.com'), false)
  assert.equal(matcher.ownsDomain('acme.com.evil.com'), false)
})

test('isSelf recognises the brand under its own name and domain stem', () => {
  const matcher = createBrandMatcher({ companyName: 'Acme Insurance', domain: 'acmeinsurance.com' })
  assert.equal(matcher.isSelf('Acme Insurance'), true)
  assert.equal(matcher.isSelf('Acme'), true)
  assert.equal(matcher.isSelf('Other Co'), false)
})

test('snippet returns text around the first match with ellipsis markers', () => {
  const matcher = createBrandMatcher({ companyName: 'Acme', domain: 'acme.com' })
  const text = 'x'.repeat(300) + ' Acme is great ' + 'y'.repeat(300)
  const snippet = matcher.snippet(text, 20)
  assert.ok(snippet)
  assert.ok(snippet!.startsWith('…'))
  assert.ok(snippet!.endsWith('…'))
  assert.ok(snippet!.includes('Acme'))
})

test('normalizeBrandName strips corporate suffixes and punctuation', () => {
  assert.equal(normalizeBrandName('Acme Insurance, LLC'), 'acme insurance')
  assert.equal(normalizeBrandName('Acme Corp.'), 'acme')
})
