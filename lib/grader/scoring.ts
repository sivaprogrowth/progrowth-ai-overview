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
 *
 * Visibility, citation and competitive credit are counted per AI ANSWER (one
 * query × one engine), not per query: a query that only one of three engines
 * names the brand in is a third of the evidence, not all of it.
 */

import { normalizeBrandName } from './brand-matcher'
import { clampScore, gradeFor, round1 } from './grade'
import { sentimentIndex } from './sentiment'
import type {
  CitationSummary,
  CompetitorResult,
  EngineAnswer,
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
  readiness: ReadinessResult
}

const ALL_CATEGORIES: QueryCategory[] = [
  'category_discovery',
  'recommendation_intent',
  'brand_evaluation',
  'alternatives_comparison',
]

/**
 * Query categories that do NOT put the brand's name in the question. Answers
 * to brand_evaluation / alternatives_comparison queries repeat the brand
 * because they were asked about it, so they carry no competitive signal.
 */
const GENERIC_CATEGORIES = new Set<QueryCategory>(['category_discovery', 'recommendation_intent'])

/** Owned-citation share (%) that earns full marks for that half of Citation Authority. */
const OWNED_SHARE_FOR_FULL_MARKS = 25

function answeredCount(queries: QueryAnalysisResult[]): number {
  return queries.reduce((sum, q) => sum + q.enginesAnswered.length, 0)
}

function mentioningCount(queries: QueryAnalysisResult[]): number {
  return queries.reduce((sum, q) => sum + q.enginesMentioning.length, 0)
}

function successfulAnswers(queries: QueryAnalysisResult[]): EngineAnswer[] {
  return queries.flatMap((q) => q.per.filter((a) => a.error === null))
}

/**
 * AI Visibility — 30 points.
 *   20 pts × (answers naming the brand / answered answers)
 * +  5 pts × mean(1 / brandPosition) across queries with a known position
 *            (position 1 → full 5, position 2 → 2.5, …)
 * +  5 pts × (high-priority answers naming the brand / high-priority
 *            answered answers) — category_discovery + recommendation_intent
 *            are the "high" priority queries per the query generator.
 */
function scoreVisibility(queries: QueryAnalysisResult[]): ScoreCategory {
  const answered = answeredCount(queries)
  const mentioning = mentioningCount(queries)
  const presence = answered > 0 ? mentioning / answered : 0

  const withPosition = queries.filter((q) => q.brandPosition !== null)
  const positionFactor =
    withPosition.length > 0
      ? withPosition.reduce((sum, q) => sum + 1 / (q.brandPosition as number), 0) / withPosition.length
      : 0

  const highPriority = queries.filter((q) => q.priority === 'high')
  const highPriorityAnswered = answeredCount(highPriority)
  const highPriorityMentioning = mentioningCount(highPriority)
  const highPriorityFactor = highPriorityAnswered > 0 ? highPriorityMentioning / highPriorityAnswered : 0

  const score = presence * 20 + positionFactor * 5 + highPriorityFactor * 5

  return {
    id: 'visibility',
    label: 'AI Visibility',
    score: clampScore(score, 30),
    max: 30,
    detail:
      `${mentioning}/${answered} AI answers name the brand (${round1(presence * 100)}%) across ${queries.length} queries; ` +
      (withPosition.length > 0
        ? `avg position factor ${round1(positionFactor * 100)}% across ${withPosition.length} ranked queries; `
        : 'no ranked positions available; ') +
      `${highPriorityMentioning}/${highPriorityAnswered} high-priority answers name the brand.`,
  }
}

/**
 * Citation Authority — 20 points. Only citations of the brand's OWN site
 * count: an answer citing sources in general says nothing about the brand.
 *   10 pts × (answers citing the brand's own site / answered answers)
 * + 10 pts × min(ownedShare / 25%, 1)   — full marks when a quarter of every
 *                                         citation points at the brand's site
 * An answer cites the brand's site exactly when its brandPosition is set
 * (see EngineAnswer.brandPosition).
 */
function scoreCitationAuthority(queries: QueryAnalysisResult[], citations: CitationSummary): ScoreCategory {
  const answers = successfulAnswers(queries)
  const citingOwned = answers.filter((a) => a.brandPosition !== null).length
  const answerShare = answers.length > 0 ? citingOwned / answers.length : 0

  const answerPoints = answerShare * 10
  const sharePoints = Math.min(citations.ownedShare / OWNED_SHARE_FOR_FULL_MARKS, 1) * 10

  return {
    id: 'citation',
    label: 'Citation Authority',
    score: clampScore(answerPoints + sharePoints, 20),
    max: 20,
    detail:
      `brand's own site cited in ${citingOwned}/${answers.length} AI answers; ` +
      `owned-domain citation share ${citations.ownedShare}% (full marks at ${OWNED_SHARE_FOR_FULL_MARKS}%).`,
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
 * Competitive Share — 15 points. Compares like with like: answers to the
 * GENERIC queries that name the brand, against answers to the same queries
 * that name the most-visible competitor. Each answer counts once per name.
 *   15 pts × min(brand answers / top-competitor answers, 1)
 * Matching the most-visible competitor earns full marks. When neither the
 * brand nor any competitor is named in a generic answer there is no
 * comparative signal — the category scores 0 and says so explicitly.
 */
function scoreCompetitive(queries: QueryAnalysisResult[]): ScoreCategory {
  const answers = successfulAnswers(queries.filter((q) => GENERIC_CATEGORIES.has(q.category)))
  const brandAnswers = answers.filter((a) => a.brandMentioned).length

  const byCompetitor = new Map<string, { name: string; answers: number }>()
  for (const answer of answers) {
    const seen = new Set<string>()
    for (const name of answer.competitors) {
      const key = normalizeBrandName(name)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const entry = byCompetitor.get(key) ?? { name, answers: 0 }
      entry.answers += 1
      byCompetitor.set(key, entry)
    }
  }
  let top: { name: string; answers: number } | null = null
  for (const entry of byCompetitor.values()) {
    if (top === null || entry.answers > top.answers) top = entry
  }

  if (top === null) {
    if (brandAnswers === 0) {
      return {
        id: 'competitive',
        label: 'Competitive Share',
        score: 0,
        max: 15,
        detail: 'Neither the brand nor any competitor was named in a generic-query answer — no comparative signal.',
      }
    }
    return {
      id: 'competitive',
      label: 'Competitive Share',
      score: 15,
      max: 15,
      detail: `brand named in ${brandAnswers}/${answers.length} generic-query answers; no competitor named.`,
    }
  }

  const ratio = Math.min(brandAnswers / top.answers, 1)
  return {
    id: 'competitive',
    label: 'Competitive Share',
    score: clampScore(ratio * 15, 15),
    max: 15,
    detail:
      `brand named in ${brandAnswers}/${answers.length} generic-query answers vs ${top.answers} ` +
      `for the most-visible competitor (${top.name}).`,
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
    scoreCompetitive(input.queries),
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
