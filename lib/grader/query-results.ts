/**
 * Per-query rollup: groups the flat EngineAnswer[] (one per query×engine
 * pair) back into one QueryAnalysisResult per query, and folds in the
 * per-answer sentiment classification.
 *
 * Pure module — no I/O.
 */

import { classifyAnswerSentiment } from './sentiment'
import type { BrandMatcher } from './brand-matcher'
import type {
  EngineAnswer,
  GeneratedQuery,
  QueryAnalysisResult,
  SentimentLabel,
} from './types'

/** Priority order among per-answer labels when an engine disagrees with itself. */
const SENTIMENT_RANK: Record<SentimentLabel, number> = {
  negative: 0,
  mixed: 1,
  positive: 2,
  neutral: 3,
  unknown: 4,
}

export function buildQueryResults(
  plan: GeneratedQuery[],
  answers: EngineAnswer[],
  matcher: BrandMatcher
): QueryAnalysisResult[] {
  const byQuery = new Map<string, EngineAnswer[]>()
  for (const answer of answers) {
    const key = answer.query
    const list = byQuery.get(key) ?? []
    list.push(answer)
    byQuery.set(key, list)
  }

  return plan.map((q) => {
    const per = byQuery.get(q.query) ?? []
    const enginesAnswered = per.filter((a) => a.error === null).map((a) => a.engine)
    const enginesMentioning = per.filter((a) => a.error === null && a.brandMentioned).map((a) => a.engine)
    const brandMentioned = enginesMentioning.length > 0

    let brandPosition: number | null = null
    for (const a of per) {
      if (a.brandPosition !== null && (brandPosition === null || a.brandPosition < brandPosition)) {
        brandPosition = a.brandPosition
      }
    }

    const competitors = Array.from(new Set(per.flatMap((a) => a.competitors)))
    const citations = per.flatMap((a) => a.citations)

    // Representative answer text: prefer the first engine that actually
    // named the brand (its snippet is what a reader wants to see), else the
    // first successful answer, else empty.
    const mentioningAnswer = per.find((a) => a.error === null && a.brandMentioned)
    const anyAnswer = per.find((a) => a.error === null)
    const source = mentioningAnswer ?? anyAnswer
    const answerText = source
      ? matcher.snippet(source.answerText, 260) ?? source.answerText.slice(0, 300)
      : ''

    // Sentiment: worst-case across engines that named the brand, since a
    // single negative framing is the thing a business needs to know about.
    let sentiment: SentimentLabel = 'unknown'
    let sentimentRank = SENTIMENT_RANK.unknown
    for (const a of per) {
      if (a.error !== null || !a.brandMentioned) continue
      const { sentiment: s } = classifyAnswerSentiment(a, matcher)
      if (SENTIMENT_RANK[s] < sentimentRank) {
        sentiment = s
        sentimentRank = SENTIMENT_RANK[s]
      }
    }

    return {
      query: q.query,
      category: q.category,
      priority: q.priority,
      brandMentioned,
      brandPosition,
      enginesMentioning,
      enginesAnswered,
      answerText,
      competitors,
      citations,
      sentiment,
      per,
    }
  })
}
