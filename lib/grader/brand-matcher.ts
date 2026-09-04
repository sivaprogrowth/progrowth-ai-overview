/**
 * Brand matching for the grader.
 *
 * lib/clients.ts already does this for the internal product, but its
 * `buildBrandMatchPatterns` takes a full `Client` row (alt_domains,
 * brand_name_patterns, …) that a public grader submission simply does not
 * have. This module applies the same approach — escaped, word-bounded
 * regexes over the company name and the domain stem — to a bare
 * {companyName, domain} pair.
 *
 * The failure mode this guards against: a naive `text.includes(name)` match
 * on a brand like "Progressive" fires on "progressive rates", "progressive
 * lenses" and "a progressive approach". So:
 *   - every pattern is \b-anchored;
 *   - a single-token brand shorter than 4 characters is only matched when it
 *     is followed by a company/industry qualifier or appears as a domain;
 *   - generic single words (see GENERIC_BRAND_TOKENS) require a qualifier
 *     too.
 *
 * Dependency-free leaf — safe to unit test in isolation.
 */

/** Corporate suffixes stripped before building a name pattern. */
const CORPORATE_SUFFIX =
  /\s+(llc|l\.l\.c\.|inc\.?|incorporated|ltd\.?|limited|corp\.?|corporation|co\.?|plc|gmbh|s\.a\.|pty|group|holdings)$/i

/**
 * Single-word brand tokens that are also ordinary English. Matching one of
 * these alone produces false positives, so it must be qualified.
 */
const GENERIC_BRAND_TOKENS = new Set([
  'progressive', 'liberty', 'travelers', 'hartford', 'guardian', 'principal',
  'nationwide', 'general', 'american', 'national', 'united', 'first',
  'premier', 'select', 'apple', 'orange', 'shield', 'summit', 'apex',
  'pinnacle', 'horizon', 'meridian', 'anchor', 'beacon', 'compass',
])

/** Words that, following a generic token, make it read as a company name. */
const QUALIFIERS = [
  'insurance', 'insurers', 'group', 'company', 'companies', 'corp',
  'corporation', 'inc', 'llc', 'ltd', 'services', 'solutions', 'partners',
  'agency', 'brokers', 'brokerage', 'holdings', 'systems', 'technologies',
  'labs', 'software', 'health', 'financial', 'capital', 'bank', 'mutual',
]

export interface BrandIdentity {
  companyName: string
  /** Bare host, no protocol/www. */
  domain: string
}

export interface BrandMatcher {
  identity: BrandIdentity
  /** True when the brand is named in visible answer text. */
  mentionedIn(text: string): boolean
  /** True when a cited domain belongs to the brand (incl. subdomains). */
  ownsDomain(domain: string): boolean
  /** ±`radius` chars around the first name match, or null. */
  snippet(text: string, radius?: number): string | null
  /** True when a discovered competitor name is really the brand itself. */
  isSelf(name: string): boolean
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** "https://www.Acme-Corp.com/x" → "acme-corp.com" (no-op on a bare host). */
export function bareHost(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./i, '')
    .replace(/\.$/, '')
    .toLowerCase()
}

/** "acme-corp.co.uk" → "acme-corp" (the registrable label, hyphens kept). */
export function domainStem(domain: string): string {
  const host = bareHost(domain)
  const labels = host.split('.')
  // Drop the public suffix: 2 labels for a known 2-part ccTLD, else 1.
  const twoPart = /\.(co|com|net|org|gov|edu|ac)\.[a-z]{2}$/.test(host)
  const stemLabels = labels.slice(0, Math.max(1, labels.length - (twoPart ? 2 : 1)))
  return stemLabels[stemLabels.length - 1] ?? host
}

/** Normalise a brand/competitor name for comparison and de-duplication. */
export function normalizeBrandName(name: string): string {
  return name
    .replace(CORPORATE_SUFFIX, '')
    .replace(/[^\p{L}\p{N}\s&'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildNamePatterns(identity: BrandIdentity): RegExp[] {
  const patterns: RegExp[] = []
  const cleanName = identity.companyName.replace(CORPORATE_SUFFIX, '').trim()
  const tokens = cleanName.split(/\s+/).filter(Boolean)

  if (tokens.length >= 2) {
    // Multi-word names are specific enough on their own. Allow flexible
    // whitespace so "Acme  Insurance" and "Acme Insurance" both match.
    patterns.push(new RegExp(`\\b${tokens.map(escapeRegex).join('\\s+')}\\b`, 'i'))
  }

  if (tokens.length === 1) {
    const token = tokens[0]
    const lower = token.toLowerCase()
    const risky = GENERIC_BRAND_TOKENS.has(lower) || token.length < 4
    if (risky) {
      // Require a company qualifier immediately after the token, e.g.
      // "Progressive Insurance" / "Progressive Corp" — never bare
      // "a progressive policy".
      patterns.push(
        new RegExp(`\\b${escapeRegex(token)}\\s+(?:${QUALIFIERS.join('|')})\\b`, 'i')
      )
    } else {
      patterns.push(new RegExp(`\\b${escapeRegex(token)}\\b`, 'i'))
    }
  }

  // The domain stem is a strong identifier when it differs from the name
  // (e.g. company "Acme Commercial", domain "acmecom.com") — but it must
  // NOT bypass the same generic-token guard as the name pattern above.
  // Without this check, a brand like "Progressive" whose domain is
  // progressive.com would still get an unqualified `\bprogressive\b`
  // pattern added here even though the name branch correctly refused to
  // (it required a qualifier like "Progressive Insurance"), and the whole
  // point of that guard — not matching "a progressive approach" — would
  // be undone by this fallback.
  const stem = domainStem(identity.domain)
  const stemIsRiskyToken = GENERIC_BRAND_TOKENS.has(stem.toLowerCase()) || stem.length < 4
  if (stem.length >= 4 && !stemIsRiskyToken && !patterns.some((p) => p.test(stem))) {
    patterns.push(new RegExp(`\\b${escapeRegex(stem)}\\b`, 'i'))
  }

  // The bare domain itself, as written in an answer body.
  patterns.push(new RegExp(escapeRegex(bareHost(identity.domain)), 'i'))

  return patterns
}

export function createBrandMatcher(identity: BrandIdentity): BrandMatcher {
  const host = bareHost(identity.domain)
  const patterns = buildNamePatterns({ companyName: identity.companyName, domain: host })
  const selfKeys = new Set(
    [normalizeBrandName(identity.companyName), domainStem(host), host].filter(Boolean)
  )

  function ownsDomain(domain: string): boolean {
    const d = bareHost(domain)
    if (!d) return false
    return d === host || d.endsWith(`.${host}`)
  }

  return {
    identity: { companyName: identity.companyName, domain: host },

    mentionedIn(text: string): boolean {
      if (!text) return false
      return patterns.some((p) => p.test(text))
    },

    ownsDomain,

    snippet(text: string, radius = 220): string | null {
      if (!text) return null
      for (const p of patterns) {
        const m = p.exec(text)
        if (m && m.index !== undefined) {
          const start = Math.max(0, m.index - radius)
          const end = Math.min(text.length, m.index + m[0].length + radius)
          return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '')
        }
      }
      return null
    },

    isSelf(name: string): boolean {
      const n = normalizeBrandName(name)
      if (!n) return false
      if (selfKeys.has(n)) return true
      // "Acme" vs "Acme Insurance Group" — treat a prefix/suffix containment
      // of the normalised company name as the same brand.
      const self = normalizeBrandName(identity.companyName)
      if (self && (n.startsWith(self) || self.startsWith(n))) return true
      return ownsDomain(n.replace(/\s+/g, ''))
    },
  }
}
