/**
 * Server-only SSRF hardening for lib/grader/readiness.ts (Phase 3, Task 15).
 *
 * lib/grader/normalize.ts already refuses an obviously-private hostname or
 * IP literal AT SUBMISSION TIME (Phase 1) — but that check runs once, on
 * the string the user typed, and is deliberately dependency-free so it can
 * also run client-side for instant form feedback. It does NOT know what a
 * domain name actually resolves to, and it never re-checks a redirect
 * target. Two real gaps followed:
 *
 *   1. A legitimate-looking domain can redirect (301/302/...) to
 *      `http://169.254.169.254/` or `http://localhost/admin` — the old
 *      boundedFetch only checked the redirect target's URL *scheme*, never
 *      its host, so it would follow the hop.
 *   2. DNS rebinding / a simply-misconfigured domain: the hostname string
 *      passes every textual check but its A/AAAA record points at a
 *      private range. fetch() connects to whatever DNS returns; nothing
 *      upstream of it ever looks at the resolved address.
 *
 * This module closes both for the ONE place this codebase makes a live
 * HTTP request to a user-submitted domain (the readiness checker — the
 * DataForSEO answer-engine calls run on DataForSEO's infrastructure, not
 * ours, so they are not this codebase's SSRF surface).
 *
 * HONEST LIMITATION: this checks the resolved address at request time,
 * which narrows but does not eliminate DNS-rebinding risk — a DNS answer
 * could theoretically change between this check and the runtime's own
 * connect() a few milliseconds later (a TOCTOU race). Fully closing that
 * needs a low-level HTTP client that connects to the exact IP this lookup
 * returned (e.g. a custom undici Agent), which is materially more
 * invasive than Phase 3's "harden, don't rearchitect" scope for a Sunday
 * launch. This is documented as a known residual risk, not silently
 * accepted — see the Phase 3 report's Security section.
 */

import dns from 'node:dns'
import { isPrivateIpv4, isPrivateIpv6, isIpv4 } from './normalize'

export interface HostCheckResult {
  safe: boolean
  /** Present only when `safe` is false — never shown to the public caller. */
  reason?: string
}

function stripBrackets(host: string): string {
  return host.replace(/^\[/, '').replace(/\]$/, '')
}

/**
 * Resolve `hostname` and confirm every returned address is public. Never
 * throws — a lookup failure is reported as unsafe (fail closed) rather
 * than propagating a DNS exception to the caller.
 */
export async function isSafeHostToFetch(hostname: string): Promise<HostCheckResult> {
  const host = stripBrackets(hostname.toLowerCase())

  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { safe: false, reason: 'private IP literal' }
  }
  if (isIpv4(host)) {
    // Public IPv4 literal — nothing to resolve.
    return { safe: true }
  }
  if (host.includes(':')) {
    // An IPv6 literal that wasn't caught by isPrivateIpv6 above is public.
    return { safe: true }
  }

  try {
    const results = await dns.promises.lookup(host, { all: true, verbatim: true })
    if (results.length === 0) {
      return { safe: false, reason: 'domain did not resolve to any address' }
    }
    for (const { address, family } of results) {
      if (family === 4 && isPrivateIpv4(address)) {
        return { safe: false, reason: 'domain resolves to a private address' }
      }
      if (family === 6 && isPrivateIpv6(address)) {
        return { safe: false, reason: 'domain resolves to a private address' }
      }
    }
    return { safe: true }
  } catch (e) {
    return { safe: false, reason: e instanceof Error ? `DNS lookup failed: ${e.message}` : 'DNS lookup failed' }
  }
}
