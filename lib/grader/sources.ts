/**
 * Curated source-domain taxonomy.
 *
 * Two consumers:
 *   1. lib/grader/citations.ts — labels a cited domain's source type. Only
 *      domains on these lists get a type; everything else is `null` rather
 *      than a guess.
 *   2. lib/grader/competitors.ts — a name derived from one of these domains
 *      is a publisher/aggregator, NOT a competitor, and is excluded from
 *      share-of-voice.
 *
 * Matching is suffix-based, so `www.forbes.com` and `advisor.forbes.com`
 * both resolve to `forbes.com`. Dependency-free leaf.
 */

import type { CitationSourceType } from './types'

/** Review / rating platforms — third-party proof surfaces. */
export const REVIEW_DOMAINS = [
  'g2.com', 'capterra.com', 'trustpilot.com', 'trustradius.com', 'yelp.com',
  'sitejabber.com', 'consumeraffairs.com', 'clutch.co', 'getapp.com',
  'softwareadvice.com', 'glassdoor.com', 'producthunt.com', 'consumerreports.org',
]

/** Directories, marketplaces and B2B databases. */
export const DIRECTORY_DOMAINS = [
  'bbb.org', 'crunchbase.com', 'owler.com', 'zoominfo.com', 'yellowpages.com',
  'manta.com', 'thumbtack.com', 'angi.com', 'houzz.com', 'expertise.com',
  'upcity.com', 'goodfirms.co', 'designrush.com', 'indeed.com', 'gartner.com',
]

/** News, magazines and editorial/affiliate comparison publishers. */
export const PUBLISHER_DOMAINS = [
  'forbes.com', 'businessinsider.com', 'cnbc.com', 'nytimes.com', 'wsj.com',
  'bloomberg.com', 'reuters.com', 'techcrunch.com', 'theverge.com', 'wired.com',
  'pcmag.com', 'cnet.com', 'zdnet.com', 'usnews.com', 'nerdwallet.com',
  'bankrate.com', 'investopedia.com', 'valuepenguin.com', 'thezebra.com',
  'policygenius.com', 'insure.com', 'insurancebusinessmag.com', 'entrepreneur.com',
  'inc.com', 'fastcompany.com', 'hbr.org', 'marketwatch.com', 'fool.com',
  'time.com', 'theguardian.com', 'bbc.com', 'axios.com', 'searchengineland.com',
  'searchenginejournal.com', 'moz.com', 'semrush.com', 'ahrefs.com',
]

/** Social / UGC platforms. */
export const SOCIAL_DOMAINS = [
  'reddit.com', 'quora.com', 'linkedin.com', 'facebook.com', 'instagram.com',
  'youtube.com', 'twitter.com', 'x.com', 'tiktok.com', 'medium.com',
  'substack.com', 'pinterest.com', 'threads.net', 'discord.com',
]

/** Encyclopaedic / governmental / standards references. */
export const REFERENCE_DOMAINS = [
  'wikipedia.org', 'wikidata.org', 'britannica.com', 'sec.gov', 'irs.gov',
  'sba.gov', 'usa.gov', 'naic.org', 'iso.org', 'ftc.gov', 'census.gov',
  'github.com', 'stackoverflow.com', 'developers.google.com', 'support.google.com',
]

const TYPED: Array<[CitationSourceType, string[]]> = [
  ['review', REVIEW_DOMAINS],
  ['directory', DIRECTORY_DOMAINS],
  ['publisher', PUBLISHER_DOMAINS],
  ['social', SOCIAL_DOMAINS],
  ['reference', REFERENCE_DOMAINS],
]

/**
 * Every domain that is a source ABOUT a market rather than a participant
 * IN it. A brand name derived from one of these is never a competitor.
 */
export const NON_COMPETITOR_DOMAINS = new Set(
  [...REVIEW_DOMAINS, ...DIRECTORY_DOMAINS, ...PUBLISHER_DOMAINS, ...SOCIAL_DOMAINS, ...REFERENCE_DOMAINS]
)

function suffixMatch(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/** Classify a cited domain, or null when it is not confidently classifiable. */
export function classifySource(host: string): CitationSourceType | null {
  const h = host.toLowerCase().replace(/^www\./, '')
  for (const [type, list] of TYPED) {
    if (list.some((d) => suffixMatch(h, d))) return type
  }
  return null
}

/** True when the host is a source-about-the-market, not a market participant. */
export function isNonCompetitorDomain(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '')
  for (const d of NON_COMPETITOR_DOMAINS) {
    if (suffixMatch(h, d)) return true
  }
  return false
}
