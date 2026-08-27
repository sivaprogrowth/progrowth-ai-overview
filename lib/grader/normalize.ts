/**
 * Public-input validation + normalisation for the AI Grader.
 *
 * This is the ONLY trust boundary between anonymous internet input and the
 * grader pipeline: everything downstream assumes a NormalizedGraderInput is
 * already safe to interpolate into a query string and to fetch over HTTPS.
 *
 * Two jobs:
 *   1. Canonicalise the domain — https://www.Example.com/pricing → example.com
 *   2. Refuse anything that would turn the readiness fetcher into an SSRF
 *      probe (localhost, loopback, link-local, RFC1918/RFC4193, non-http
 *      schemes) or that would let a caller push unbounded text into the
 *      prompt templates and the database.
 *
 * No new dependency: the repo ships no schema validator, and the rule set
 * here is small and explicit enough that adding one would be net negative.
 * `cleanDomain` from lib/clientInput.ts is reused for the strip step.
 */

import { cleanDomain } from '../clientInput'
import type { GraderInput, NormalizationIssue, NormalizeResult } from './types'

/** Public input caps. Bound both prompt size and row size. */
export const FIELD_LIMITS = {
  domain: 253, // RFC 1035 max FQDN length
  companyName: 150,
  industry: 150,
  service: 250,
  location: 150,
} as const

/** Schemes we accept in a pasted URL. Everything else is rejected outright. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:'])

/** Hostnames that must never be fetched, whatever the caller claims. */
const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'broadcasthost',
])

/** Reserved/internal TLDs — never a real public brand domain. */
const BLOCKED_TLDS = new Set(['local', 'localhost', 'internal', 'test', 'example', 'invalid', 'onion'])

/**
 * A hostname label: 1–63 chars, alphanumeric plus internal hyphens.
 * Deliberately ASCII-only — a punycode host (xn--…) still matches, a raw
 * unicode host does not and is rejected rather than silently mangled.
 */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function isIpv4(host: string): boolean {
  const parts = host.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/**
 * True for any IPv4 literal that is not globally routable: loopback,
 * RFC1918 private, link-local, CGNAT, multicast, broadcast, "this network".
 */
export function isPrivateIpv4(host: string): boolean {
  if (!isIpv4(host)) return false
  const [a, b] = host.split('.').map(Number)
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // multicast + reserved + 255.255.255.255
  return false
}

/** True for an IPv6 literal that is loopback, unspecified, ULA or link-local. */
export function isPrivateIpv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (!h.includes(':')) return false
  if (h === '::1' || h === '::') return true
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true // fc00::/7 unique-local
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true // fe80::/10 link-local
  return false
}

function trimField(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
}

/**
 * Canonicalise a user-supplied domain or URL to a bare lowercase host.
 * Returns null (with a reason) for anything unsafe or malformed.
 */
export function normalizeDomain(raw: unknown): { host: string } | { error: string } {
  const input = trimField(raw)
  if (!input) return { error: 'domain is required' }
  if (input.length > FIELD_LIMITS.domain + 32) return { error: 'domain is too long' }

  // Reject dangerous schemes BEFORE any stripping, so `javascript:alert(1)`
  // can never be silently reduced to a plausible-looking host.
  //
  // Two separate checks, not one general "any colon-prefixed scheme is
  // suspect" rule: a scheme is only unambiguous when followed by `//`
  // (`ftp://evil.com`). Without the `//` requirement, legitimate URL
  // userinfo syntax — `user:pass@example.com` — is indistinguishable from
  // a bare scheme and was previously misidentified as scheme "user:" and
  // rejected outright. The genuinely dangerous bare (no `//`) schemes are
  // few and known, so they get an explicit denylist instead.
  const dangerousBareScheme = input.match(/^\s*(javascript|data|vbscript|file):/i)
  if (dangerousBareScheme) {
    return { error: `unsupported URL scheme "${dangerousBareScheme[1].toLowerCase()}:" — use http(s) or a bare domain` }
  }
  const schemeSlashMatch = input.match(/^([a-z][a-z0-9+.-]*):\/\//i)
  if (schemeSlashMatch && !ALLOWED_SCHEMES.has(`${schemeSlashMatch[1].toLowerCase()}:`)) {
    return { error: `unsupported URL scheme "${schemeSlashMatch[1].toLowerCase()}:" — use http(s) or a bare domain` }
  }

  // cleanDomain (lib/clientInput.ts) strips protocol + path + lowercases.
  let host = cleanDomain(input)
  host = host.replace(/^www\./, '')
  // Drop credentials, port and any trailing dot.
  host = host.replace(/^[^/@]*@/, '').replace(/:\d+$/, '').replace(/\.$/, '')

  if (!host) return { error: 'domain could not be parsed' }
  if (host.length > FIELD_LIMITS.domain) return { error: 'domain is too long' }
  if (BLOCKED_HOSTS.has(host)) return { error: `"${host}" is not a public domain` }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { error: 'private and loopback addresses are not accepted' }
  }
  if (isIpv4(host)) return { error: 'enter a domain name, not an IP address' }
  if (host.includes(':')) return { error: 'enter a domain name, not an IP address' }

  const labels = host.split('.')
  if (labels.length < 2) return { error: `"${host}" is not a valid domain` }
  if (!labels.every((l) => LABEL.test(l))) return { error: `"${host}" is not a valid domain` }

  const tld = labels[labels.length - 1]
  if (!/^[a-z]{2,}$/.test(tld) && !tld.startsWith('xn--')) {
    return { error: `"${host}" has an invalid top-level domain` }
  }
  if (BLOCKED_TLDS.has(tld)) return { error: `".${tld}" is a reserved top-level domain` }

  return { host }
}

function checkLength(
  field: 'companyName' | 'industry' | 'service' | 'location',
  value: string,
  required: boolean,
  issues: NormalizationIssue[]
): string | null {
  if (!value) {
    if (required) issues.push({ field, message: `${field} is required` })
    return null
  }
  if (required && value.length < 2) {
    issues.push({ field, message: `${field} is too short` })
    return null
  }
  if (value.length > FIELD_LIMITS[field]) {
    issues.push({ field, message: `${field} must be ${FIELD_LIMITS[field]} characters or fewer` })
    return null
  }
  return value
}

/**
 * Validate + normalise a raw public request body. Never throws; collects
 * every problem so the API can return them all at once.
 */
export function normalizeGraderInput(raw: unknown): NormalizeResult {
  const issues: NormalizationIssue[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [{ field: 'input', message: 'request body must be a JSON object' }] }
  }
  const body = raw as Partial<Record<keyof GraderInput, unknown>>

  const domainResult = normalizeDomain(body.domain)
  if ('error' in domainResult) {
    issues.push({ field: 'domain', message: domainResult.error })
  }

  const companyName = checkLength('companyName', trimField(body.companyName), true, issues)
  const industry = checkLength('industry', trimField(body.industry), true, issues)
  const service = checkLength('service', trimField(body.service), false, issues)
  const location = checkLength('location', trimField(body.location), false, issues)

  if (issues.length > 0 || !('host' in domainResult) || !companyName || !industry) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    value: {
      domain: domainResult.host,
      companyName,
      industry,
      service: service || null,
      location: location || null,
      homepageUrl: `https://${domainResult.host}`,
    },
  }
}
