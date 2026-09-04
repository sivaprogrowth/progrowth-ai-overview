/**
 * Competitor discovery + share-of-voice aggregation.
 *
 * The user never supplies competitors — they are discovered from what the
 * answer engines actually named. Two evidence sources, both deterministic:
 *
 *   1. STRUCTURE. Recommendation answers are lists: `**Acme Insurance** —`,
 *      `1. Acme Insurance: …`, `### Acme Insurance`, `[Acme](https://…)`.
 *      Pulling the list item's leading name is far more precise than
 *      capitalised-word-run NER over prose.
 *   2. CITATIONS. A cited domain that is not a publisher/review/directory
 *      (lib/grader/sources.ts) is almost always a market participant, so
 *      its stem becomes a candidate name.
 *
 * Everything is filtered through the brand matcher (never count yourself)
 * and a stopword list of section headings that look like proper nouns.
 *
 * Pure module — no I/O, no LLM. Unit-testable in isolation.
 */

import { isNonCompetitorDomain } from './sources'
import { normalizeBrandName, bareHost, domainStem, type BrandMatcher } from './brand-matcher'
import { round1 } from './grade'
import type { CitationRef, CompetitorResult, EngineAnswer } from './types'

/** Max competitors returned in a Phase 1 report. */
export const MAX_COMPETITORS = 5

/**
 * Headings, list labels and marketing words that survive the structural
 * extractors but are not companies.
 */
const NOT_A_BRAND = new Set([
  'introduction', 'overview', 'summary', 'conclusion', 'key takeaways',
  'takeaways', 'pros', 'cons', 'pros and cons', 'note', 'notes', 'disclaimer',
  'best', 'top', 'top picks', 'our pick', 'recommendation', 'recommendations',
  'why', 'how', 'what', 'when', 'where', 'who', 'which', 'others', 'other',
  'more', 'see also', 'sources', 'references', 'faq', 'faqs', 'tips',
  'considerations', 'next steps', 'bottom line', 'the bottom line',
  'important', 'example', 'examples', 'options', 'option', 'features',
  'pricing', 'cost', 'costs', 'coverage', 'benefits', 'services', 'service',
  'providers', 'provider', 'companies', 'company', 'insurance', 'quote',
  'quotes', 'small business', 'businesses', 'customer service', 'reviews',
  'review', 'rating', 'ratings', 'about', 'contact', 'home', 'blog',
  'a', 'an', 'the', 'and', 'or', 'for', 'with', 'you', 'your', 'they',
])

/** Fragments that mark a captured string as prose, not a company name. */
const PROSE_MARKERS = /\b(?:is|are|was|were|has|have|will|can|should|offers|provides|includes|that|this|these|those)\b/i

function isPlausibleBrand(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 60) return false
  const words = trimmed.split(/\s+/)
  if (words.length > 5) return false
  const normal = normalizeBrandName(trimmed)
  if (!normal || NOT_A_BRAND.has(normal)) return false
  if (PROSE_MARKERS.test(trimmed)) return false
  // Must contain a letter and start with an alphanumeric.
  if (!/[a-z]/i.test(trimmed) || !/^[a-z0-9]/i.test(trimmed)) return false
  return true
}

/** Strip markdown emphasis/links/trailing punctuation from a captured name. */
function cleanCapture(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/^["'“”‘’(]+|["'“”‘’),.;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "acme-insurance" → "Acme Insurance". Used for citation-derived names. */
export function prettifyStem(stem: string): string {
  return stem
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/**
 * Extract candidate brand names named in one answer body plus the brands
 * implied by its non-publisher citations. Returns display names, deduped
 * case-insensitively, excluding the graded brand itself.
 */
export function extractBrandCandidates(
  answerText: string,
  citations: CitationRef[],
  matcher: BrandMatcher
): string[] {
  const found = new Map<string, string>() // normalised → display

  const add = (raw: string) => {
    const name = cleanCapture(raw)
    if (!isPlausibleBrand(name)) return
    if (matcher.isSelf(name)) return
    const key = normalizeBrandName(name)
    if (!key || found.has(key)) return
    found.set(key, name)
  }

  const text = answerText ?? ''

  // 1. Bold spans — the dominant convention in list answers.
  for (const m of text.matchAll(/\*\*([^*\n]{2,60})\*\*/g)) add(m[1])

  // 2. Markdown headings.
  for (const m of text.matchAll(/^#{1,6}\s+(.{2,60})$/gm)) add(m[1])

  // 3. Markdown links — the link text is the brand, the href is its site.
  for (const m of text.matchAll(/\[([^\]\n]{2,60})\]\(\s*(https?:\/\/[^\s)]+)\s*\)/g)) add(m[1])

  // 4. List items: take the leading name up to a separator. Requires an
  //    initial capital so "- offers 24/7 support" is not captured.
  for (const m of text.matchAll(
    /^\s*(?:[-*•]|\d+[.)])\s+([A-Z][^\n:—–]{1,58}?)\s*(?:[:—–]|\s-\s|\(|$)/gm
  )) {
    add(m[1])
  }

  // 5. Citation-derived: a cited domain that is not a source-about-the-market
  //    is a participant in it.
  for (const c of citations) {
    const host = bareHost(c.domain || c.url)
    if (!host || isNonCompetitorDomain(host)) continue
    if (matcher.ownsDomain(host)) continue
    add(prettifyStem(domainStem(host)))
  }

  return Array.from(found.values())
}

/**
 * Aggregate competitors across every (query, engine) answer.
 *
 * shareOfVoice = competitor mentions / (brand mentions + all competitor
 * mentions) × 100 — so the shares of the brand and every competitor sum to
 * 100 across the analysed answer set.
 */
export function aggregateCompetitors(
  answers: EngineAnswer[],
  brandMentionCount: number,
  limit = MAX_COMPETITORS
): { competitors: CompetitorResult[]; totalCompetitorMentions: number } {
  const agg = new Map<
    string,
    { display: string; mentions: number; queries: Set<string> }
  >()

  for (const answer of answers) {
    for (const name of answer.competitors) {
      const key = normalizeBrandName(name)
      if (!key) continue
      const entry = agg.get(key) ?? { display: name, mentions: 0, queries: new Set<string>() }
      entry.mentions += 1
      entry.queries.add(answer.query.toLowerCase())
      agg.set(key, entry)
    }
  }

  const totalCompetitorMentions = Array.from(agg.values()).reduce((s, e) => s + e.mentions, 0)
  const denominator = totalCompetitorMentions + brandMentionCount

  const competitors = Array.from(agg.values())
    .sort((a, b) => {
      if (b.queries.size !== a.queries.size) return b.queries.size - a.queries.size
      if (b.mentions !== a.mentions) return b.mentions - a.mentions
      return a.display.localeCompare(b.display)
    })
    .slice(0, limit)
    .map((e) => ({
      name: e.display,
      mentions: e.mentions,
      queriesPresent: e.queries.size,
      shareOfVoice: denominator > 0 ? round1((e.mentions / denominator) * 100) : 0,
    }))

  return { competitors, totalCompetitorMentions }
}
