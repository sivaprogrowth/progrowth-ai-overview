/**
 * Deterministic recommendation rules for the AI Grader.
 *
 * Every rule fires off data already computed by scoring.ts / citations.ts /
 * competitors.ts — nothing here calls an LLM or invents a fact. Rules are
 * evaluated in priority order and capped (MAX_RECOMMENDATIONS) so a weak
 * report reads as a short actionable punch list, not a wall of generic
 * advice.
 *
 * Where a rule maps onto ground the internal product already covers
 * (crawl access / readiness), it points at the same Google doc URLs from
 * lib/recommendations.ts (GOOGLE_AI_PRINCIPLES) rather than inventing new
 * citations.
 */

import { GOOGLE_AI_PRINCIPLES } from '../recommendations'
import type {
  CitationSummary,
  CompetitorResult,
  QueryAnalysisResult,
  Recommendation,
  ReadinessResult,
  ScoreBreakdown,
} from './types'

export const MAX_RECOMMENDATIONS = 5
const MIN_RECOMMENDATIONS = 3

const PRIORITY_RANK: Record<Recommendation['priority'], number> = { high: 0, medium: 1, low: 2 }

export interface RecommendationInput {
  score: ScoreBreakdown
  queries: QueryAnalysisResult[]
  citations: CitationSummary
  competitors: CompetitorResult[]
  readiness: ReadinessResult
  companyName: string
}

function branded(queries: QueryAnalysisResult[]): QueryAnalysisResult[] {
  return queries.filter((q) => q.category === 'brand_evaluation')
}
function nonBranded(queries: QueryAnalysisResult[]): QueryAnalysisResult[] {
  return queries.filter((q) => q.category !== 'brand_evaluation')
}

/**
 * Pure rule set. Returns 3–5 recommendations (fewer only when the report is
 * near-perfect and few rules actually fire), highest priority first.
 */
export function buildGraderRecommendations(input: RecommendationInput): Recommendation[] {
  const { score, queries, citations, competitors, readiness, companyName } = input
  const out: Recommendation[] = []
  const push = (r: Omit<Recommendation, 'id'>) => out.push({ id: `rec-${out.length + 1}`, ...r })

  // 1. Low AI visibility → improve category/buyer-intent content.
  if (score.visibility < 20) {
    const mentioned = queries.filter((q) => q.brandMentioned).length
    push({
      priority: 'high',
      category: 'visibility',
      title: 'Improve category and buyer-intent content',
      reason: `${companyName} appeared in only ${mentioned}/${queries.length} AI-search queries tested (${score.visibility}/30 visibility points).`,
      action:
        'Publish pages that directly answer category-discovery and recommendation-intent queries ' +
        '(e.g. "best <service> in <location>", "which <service> provider should I use") with specific, ' +
        'people-first detail Google can surface in AI Overviews and answer engines can cite.',
      docUrl: GOOGLE_AI_PRINCIPLES.helpfulContent.docUrl,
    })
  }

  // 2. Low citation authority → increase third-party authority presence.
  if (score.citation < 12) {
    push({
      priority: 'high',
      category: 'citations',
      title: 'Increase third-party citation coverage',
      reason: `Only ${citations.uniqueDomains} unique domain(s) cited the brand's market and owned-domain citation share is ${citations.ownedShare}% (${score.citation}/20 citation points).`,
      action:
        'Pursue coverage on review platforms, industry directories and comparison publishers relevant to ' +
        'the industry (e.g. G2/Capterra for software, BBB/industry directories for local services) — these ' +
        'are the sources answer engines cite most often.',
    })
  }

  // 3. Competitor share significantly higher → comparison/alternatives content.
  const topCompetitor = competitors[0]
  if (topCompetitor && topCompetitor.shareOfVoice > 0 && score.competitive < 60 * (15 / 100)) {
    push({
      priority: 'high',
      category: 'competitive',
      title: 'Build comparison and alternative pages',
      reason: `"${topCompetitor.name}" was named in ${topCompetitor.queriesPresent} of the tested queries (${topCompetitor.shareOfVoice}% share of voice) versus the brand's ${score.competitive}/15 competitive-share points.`,
      action: `Publish an honest "${companyName} vs ${topCompetitor.name}" comparison and an "alternatives to ${topCompetitor.name}" ` +
        'page — these are exactly the pages AI answer engines cite for alternatives/comparison queries.',
    })
  }

  // 4. Brand mostly appears in branded queries → improve non-branded discovery.
  const brandedResults = branded(queries)
  const nonBrandedResults = nonBranded(queries)
  const brandedHitRate = brandedResults.length > 0 ? brandedResults.filter((q) => q.brandMentioned).length / brandedResults.length : 0
  const nonBrandedHitRate = nonBrandedResults.length > 0 ? nonBrandedResults.filter((q) => q.brandMentioned).length / nonBrandedResults.length : 0
  if (brandedHitRate > 0.5 && nonBrandedHitRate < 0.3 && nonBrandedResults.length > 0) {
    push({
      priority: 'medium',
      category: 'visibility',
      title: 'Improve non-branded discovery visibility',
      reason: `The brand appears for ${Math.round(brandedHitRate * 100)}% of "about us" queries but only ${Math.round(nonBrandedHitRate * 100)}% of category/recommendation queries — visibility depends on people already knowing the name.`,
      action:
        'Target the specific service + location combinations buyers search before they know any brand name, ' +
        'not just the company name itself.',
    })
  }

  // 5. Low answer coverage → build content for missing high-intent categories.
  if (score.coverage < 6) {
    const missing = Array.from(
      new Set(queries.filter((q) => !q.brandMentioned).map((q) => q.category))
    )
    push({
      priority: 'medium',
      category: 'coverage',
      title: 'Build content for missing high-intent question categories',
      reason: `The brand is absent from ${missing.length} of the query categories tested (${score.coverage}/10 coverage points).`,
      action: `Create or expand content addressing: ${missing.join(', ').replace(/_/g, ' ')}.`,
    })
  }

  // 6. Weak AI readiness → technical fixes.
  if (score.readiness < 6) {
    const failed = readiness.checks.filter((c) => c.passed === false).map((c) => c.label)
    push({
      priority: readiness.status === 'unavailable' ? 'low' : 'high',
      category: 'readiness',
      title: 'Improve structured data, crawlability and brand/entity clarity',
      reason:
        readiness.status === 'unavailable'
          ? 'The homepage could not be reached during this audit, so AI readiness could not be verified.'
          : `${readiness.passedCount}/${readiness.evaluatedCount} readiness checks passed. Failing: ${failed.join(', ') || 'see report'}.`,
      action:
        'Add Organization/LocalBusiness JSON-LD structured data, ensure a clear page title and meta ' +
        'description naming the brand and its service, and confirm robots.txt does not block Googlebot, ' +
        'OAI-SearchBot, PerplexityBot or ClaudeBot.',
      docUrl: GOOGLE_AI_PRINCIPLES.crawlAccess.docUrl,
    })
  }

  // 7. Negative/mixed sentiment flagged even when not otherwise triggered.
  const negativeQueries = queries.filter((q) => q.sentiment === 'negative' || q.sentiment === 'mixed')
  if (negativeQueries.length > 0 && !out.some((r) => r.category === 'sentiment')) {
    push({
      priority: 'medium',
      category: 'sentiment',
      title: 'Address unfavourable AI framing',
      reason: `${negativeQueries.length} answer(s) framed the brand negatively or with mixed sentiment.`,
      action: 'Review the flagged answers, correct any factual gaps on-site, and pursue fresh positive ' +
        'third-party coverage to shift how answer engines summarise the brand.',
    })
  }

  // 8. Fallback when the report is already strong: top up to the minimum.
  // A single fixed push here is not enough — a report that trips zero or
  // one of the rules above would still fall short of MIN_RECOMMENDATIONS
  // (Task 15: "Return around 3–5 recommendations"). Keep adding distinct,
  // data-grounded maintenance items — never duplicating a category already
  // covered by a triggered rule — until the minimum is met or the
  // candidate list runs out.
  const coveredCategories = new Set(out.map((r) => r.category))
  const fallbackCandidates: Array<Omit<Recommendation, 'id'>> = [
    {
      priority: 'low',
      category: 'visibility',
      title: 'Maintain and expand current AI visibility',
      reason: `Overall score is ${score.overall}/100 (${score.grade}) — the fundamentals are in place.`,
      action: 'Keep publishing fresh, specific content in the categories already winning.',
    },
    {
      priority: 'low',
      category: 'citations',
      title: 'Keep strengthening third-party citation coverage',
      reason: `${citations.uniqueDomains} domain(s) currently cite the brand's market.`,
      action: 'Continue pursuing coverage on review platforms, directories and industry publishers so citation breadth keeps growing.',
    },
    {
      priority: 'low',
      category: 'competitive',
      title: 'Monitor competitors entering the conversation',
      reason: competitors[0]
        ? `"${competitors[0].name}" is the closest named competitor at ${competitors[0].shareOfVoice}% share of voice.`
        : 'No competitor currently has a meaningful share of voice.',
      action: 'Periodically re-run this analysis to catch new entrants before they gain share of voice.',
    },
    {
      priority: 'low',
      category: 'coverage',
      title: 'Continue building coverage across buyer-intent categories',
      reason: `The brand currently scores ${score.coverage}/10 on answer coverage.`,
      action: 'Keep adding content across category-discovery, recommendation, evaluation and comparison queries as the market evolves.',
    },
    {
      priority: 'low',
      category: 'readiness',
      title: 'Maintain technical AI readiness',
      reason: `${readiness.passedCount}/${readiness.evaluatedCount || 0} readiness checks currently pass.`,
      action: 'Keep structured data, crawl access and page metadata up to date as the site changes.',
    },
  ]
  for (const candidate of fallbackCandidates) {
    if (out.length >= MIN_RECOMMENDATIONS) break
    if (coveredCategories.has(candidate.category)) continue
    push(candidate)
    coveredCategories.add(candidate.category)
  }

  return out
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    .slice(0, MAX_RECOMMENDATIONS)
}
