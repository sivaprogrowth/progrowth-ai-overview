/**
 * Deterministic scoring engine — the same report data always produces the
 * exact same score. NOT sent to an LLM: every number here is a documented
 * formula over data already computed by the earlier pipeline stages.
 *
 *   AI Visibility          30 points
 *   Citation Authority     20 points
 *   Brand Sentiment        15 points
 *   Competitive Share      15 points
 *   Answer Coverage        10 points
 *   AI Readiness           10 points
 *   ───────────────────────────────
 *   Total                 100 points
 *
 * Every category is documented inline with its exact formula so the number
 * is auditable from the report alone (see `ScoreCategory.detail`).
 */

import { clampScore, gradeFor, round1 } from './grade'
import { sentimentIndex } from './sentiment'
import type {
  CitationSummary,
  CompetitorResult,
  QueryAnalysisResult,
  QueryCategory,
  ReadinessResult,
  ScoreBreakdown,
  ScoreCategory,
  SentimentSummary,
} from './types'

export interface ScoringInput {
  queries: QueryAnalysisResult[]
  citations: CitationSummary
  sentiment: SentimentSummary
  competitors: CompetitorResult[]
  /** Total brand mentions across all (query, engine) answers (denominator partner to competitor mentions). */
  brandMentionCount: number
  totalCompetitorMentions: number
  readiness: ReadinessResult
}

const ALL_CATEGORIES: QueryCategory[] = [
  'category_discovery',
  'recommendation_intent',
  'brand_evaluation',
  'alternatives_comparison',
]

/**
 * AI Visibility — 30 points.
 *   20 pts × (queries where the brand appears / total queries)
 * +  5 pts × mean(1 / brandPosition) across queries with a known position
 *            (position 1 → full 5, position 2 → 2.5, …)
 * +  5 pts × (high-priority queries where the brand appears / total
 *            high-priority queries) — category_discovery + recommendation_
 *            intent are the "high" priority queries per the query generator.
 */
function scoreVisibility(queries: QueryAnalysisResult[]): ScoreCategory {
  const total = queries.length || 1
  const mentioned = queries.filter((q) => q.brandMentioned)
  const presence = mentioned.length / total

  const withPosition = queries.filter((q) => q.brandPosition !== null)
  const positionFactor =
    withPosition.length > 0
      ? withPosition.reduce((sum, q) => sum + 1 / (q.brandPosition as number), 0) / withPosition.length
      : 0

  const highPriority = queries.filter((q) => q.priority === 'high')
  const highPriorityMentioned = highPriority.filter((q) => q.brandMentioned)
  const highPriorityFactor = highPriority.length > 0 ? highPriorityMentioned.length / highPriority.length : 0

  const score = presence * 20 + positionFactor * 5 + highPriorityFactor * 5

  return {
    id: 'visibility',
    label: 'AI Visibility',
    score: clampScore(score, 30),
    max: 30,
    detail:
      `${mentioned.length}/${queries.length} queries mention the brand (${round1(presence * 100)}%); ` +
      (withPosition.length > 0
        ? `avg position factor ${round1(positionFactor * 100)}% across ${withPosition.length} ranked queries; `
        : 'no ranked positions available; ') +
      `${highPriorityMentioned.length}/${highPriority.length || 0} high-priority queries mention the brand.`,
  }
}

/**
 * Citation Authority — 20 points.
 *   5 pts  × min(ownedShare / 100, 1)          — the brand's own site is cited
 * + 10 pts × (answered queries with ≥1 citation of any kind / total answered)
 * +  5 pts × min(uniqueDomains / 8, 1)          — breadth of supporting sources
 */
function scoreCitationAuthority(queries: QueryAnalysisResult[], citations: CitationSummary): ScoreCategory {
  const answered = queries.filter((q) => q.enginesAnswered.length > 0)
  const withCitations = answered.filter((q) => q.citations.length > 0)
  const coverage = answered.length > 0 ? withCitations.length / answered.length : 0

  const ownedPoints = Math.min(citations.ownedShare / 100, 1) * 5
  const coveragePoints = coverage * 10
  const breadthPoints = Math.min(citations.uniqueDomains / 8, 1) * 5

  return {
    id: 'citation',
    label: 'Citation Authority',
    score: clampScore(ownedPoints + coveragePoints + breadthPoints, 20),
    max: 20,
    detail:
      `owned-domain citation share ${citations.ownedShare}%; ${withCitations.length}/${answered.length} ` +
      `answered queries carry a citation; ${citations.uniqueDomains} unique supporting domain(s).`,
  }
}

/**
 * Brand Sentiment — 15 points.
 *   15 pts × sentimentIndex   (index ∈ [0,1]: positive=1, neutral/mixed=0.5-0.6, negative=0)
 * When no answer named the brand in visible text, sentiment cannot be
 * assessed; the category falls back to the neutral midpoint (7.5/15) rather
 * than 0 or full marks, since "unmeasured" is neither good nor bad news.
 */
function scoreSentiment(sentiment: SentimentSummary): ScoreCategory {
  const index = sentimentIndex(sentiment)
  if (index === null) {
    return {
      id: 'sentiment',
      label: 'Brand Sentiment',
      score: 7.5,
      max: 15,
      detail: 'No answer named the brand in visible text — sentiment unmeasured; neutral midpoint applied.',
    }
  }
  return {
    id: 'sentiment',
    label: 'Brand Sentiment',
    score: clampScore(index * 15, 15),
    max: 15,
    detail: `${sentiment.analyzed} brand mention(s) classified — overall "${sentiment.sentiment}" (index ${round1(index)}/1).`,
  }
}

/**
 * Competitive Share — 15 points.
 *   15 pts × brandMentions / (brandMentions + competitorMentions)
 * When neither the brand nor any competitor was ever named (denominator 0),
 * there is no comparative signal — the category scores 0 and says so
 * explicitly, rather than defaulting to a misleadingly neutral score.
 */
function scoreCompetitive(brandMentionCount: number, totalCompetitorMentions: number): ScoreCategory {
  const denominator = brandMentionCount + totalCompetitorMentions
  if (denominator === 0) {
    return {
      id: 'competitive',
      label: 'Competitive Share',
      score: 0,
      max: 15,
      detail: 'Neither the brand nor any competitor was named in any answer — no comparative signal.',
    }
  }
  const share = brandMentionCount / denominator
  return {
    id: 'competitive',
    label: 'Competitive Share',
    score: clampScore(share * 15, 15),
    max: 15,
    detail: `brand share of voice ${round1(share * 100)}% (${brandMentionCount} brand vs ${totalCompetitorMentions} competitor mention(s)).`,
  }
}

/**
 * Answer Coverage — 10 points.
 *   10 pts × (query categories in which the brand appears at least once /
 *             query categories actually present in the plan)
 * Measures BREADTH across intent categories, not raw mention count — a
 * brand that only wins brand_evaluation queries (searches for its own name)
 * is not covered, it is just findable.
 */
function scoreCoverage(queries: QueryAnalysisResult[]): ScoreCategory {
  const present = new Set(queries.map((q) => q.category))
  const categoriesPresent = ALL_CATEGORIES.filter((c) => present.has(c))
  const covered = categoriesPresent.filter((c) => queries.some((q) => q.category === c && q.brandMentioned))

  const denominator = categoriesPresent.length || 1
  const score = (covered.length / denominator) * 10

  return {
    id: 'coverage',
    label: 'Answer Coverage',
    score: clampScore(score, 10),
    max: 10,
    detail: `brand appears in ${covered.length}/${categoriesPresent.length} query categories (${covered.join(', ') || 'none'}).`,
  }
}

/**
 * AI Readiness — 10 points.
 *   10 pts × passedCount / evaluatedCount
 * Checks that could not be determined (network failure, timeout) are
 * excluded from BOTH numerator and denominator so an unreachable
 * third-party check never counts against the site.
 */
function scoreReadiness(readiness: ReadinessResult): ScoreCategory {
  if (readiness.evaluatedCount === 0) {
    return {
      id: 'readiness',
      label: 'AI Readiness',
      score: 0,
      max: 10,
      detail: 'Readiness checks were unavailable (site unreachable) — scored 0 pending a re-run.',
    }
  }
  const score = (readiness.passedCount / readiness.evaluatedCount) * 10
  return {
    id: 'readiness',
    label: 'AI Readiness',
    score: clampScore(score, 10),
    max: 10,
    detail: `${readiness.passedCount}/${readiness.evaluatedCount} readiness checks passed.`,
  }
}

/** Compute the full deterministic score breakdown. Pure — no I/O. */
export function computeScore(input: ScoringInput): ScoreBreakdown {
  const categories = [
    scoreVisibility(input.queries),
    scoreCitationAuthority(input.queries, input.citations),
    scoreSentiment(input.sentiment),
    scoreCompetitive(input.brandMentionCount, input.totalCompetitorMentions),
    scoreCoverage(input.queries),
    scoreReadiness(input.readiness),
  ]

  const overall = clampScore(categories.reduce((sum, c) => sum + c.score, 0), 100)
  const byId = Object.fromEntries(categories.map((c) => [c.id, c.score])) as Record<
    ScoreCategory['id'],
    number
  >

  return {
    overall,
    grade: gradeFor(overall),
    categories,
    visibility: byId.visibility,
    citation: byId.citation,
    sentiment: byId.sentiment,
    competitive: byId.competitive,
    coverage: byId.coverage,
    readiness: byId.readiness,
  }
}
