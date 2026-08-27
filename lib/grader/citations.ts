/**
 * Citation-source aggregation.
 *
 * Answer engines show their work: every answer carries the URLs it drew on.
 * Which domains those are is the most actionable part of the report, because
 * it names the exact third-party surfaces a brand has to be present on.
 *
 * Deliberately NOT computed here: any kind of domain-authority score. The
 * repo has no authority data source (DataForSEO's backlink endpoints are not
 * wired up), so inventing one would be a fabricated metric. Only counts,
 * coverage, ownership and the curated source type from lib/grader/sources.ts
 * are reported.
 *
 * Pure module — no I/O.
 */

import { classifySource } from './sources'
import { bareHost, type BrandMatcher } from './brand-matcher'
import { round1 } from './grade'
import type { CitationSummary, CitationResult, EngineAnswer } from './types'

/** Cited domains listed in a Phase 1 report. */
export const MAX_CITATION_DOMAINS = 15

/**
 * Aggregate citations across every answer that produced one.
 *
 * `coverage` is the share of ANSWERED (query, engine) pairs that cited the
 * domain — failed calls are excluded from the denominator so a provider
 * outage cannot silently deflate every domain's coverage.
 */
export function aggregateCitations(
  answers: EngineAnswer[],
  matcher: BrandMatcher,
  limit = MAX_CITATION_DOMAINS
): CitationSummary {
  const answered = answers.filter((a) => a.error === null)
  const denominator = answered.length

  const agg = new Map<string, { mentions: number; answers: Set<string> }>()
  let totalCitations = 0

  for (const answer of answered) {
    const key = `${answer.query.toLowerCase()}::${answer.engine}`
    for (const citation of answer.citations) {
      const host = bareHost(citation.domain || citation.url)
      if (!host) continue
      totalCitations += 1
      const entry = agg.get(host) ?? { mentions: 0, answers: new Set<string>() }
      entry.mentions += 1
      entry.answers.add(key)
      agg.set(host, entry)
    }
  }

  const all: CitationResult[] = Array.from(agg.entries())
    .map(([domain, entry]) => {
      const owned = matcher.ownsDomain(domain)
      return {
        domain,
        mentions: entry.mentions,
        coverage: denominator > 0 ? round1((entry.answers.size / denominator) * 100) : 0,
        owned,
        sourceType: owned ? ('owned' as const) : classifySource(domain),
      }
    })
    .sort((a, b) => {
      if (b.mentions !== a.mentions) return b.mentions - a.mentions
      return a.domain.localeCompare(b.domain)
    })

  const ownedCitations = all.filter((d) => d.owned).reduce((s, d) => s + d.mentions, 0)
  const ownedShare = totalCitations > 0 ? round1((ownedCitations / totalCitations) * 100) : 0

  return {
    domains: all.slice(0, limit),
    uniqueDomains: all.length,
    totalCitations,
    ownedShare,
    thirdPartyShare: totalCitations > 0 ? round1(100 - ownedShare) : 0,
    thirdPartyDomains: all.filter((d) => !d.owned).length,
  }
}
