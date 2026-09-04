/**
 * Brand-mention sentiment — a SECONDARY layer that can never fail the run.
 *
 * Why this is rule-based rather than an LLM call:
 *   lib/sentiment.ts (the internal product's classifier) POSTs a ~700-char
 *   classification prompt to chat_gpt/llm_responses. That endpoint hard-
 *   rejects user_prompt > ~500 chars with a misleading 40501 (documented in
 *   lib/dataforseo.ts), so a faithful snippet-carrying prompt does not fit
 *   inside the provider's limit. A classifier that silently defaults to one
 *   label is worse than an honest deterministic one — and this way sentiment
 *   costs nothing, adds no latency, and returns the same answer every run.
 *
 * It also only ever scores answers where the brand is ACTUALLY NAMED in the
 * visible body. An answer that merely cites the brand's URL in a footnote
 * says nothing about how the brand is framed, so it is left unanalysed
 * rather than counted as neutral.
 *
 * Pure module — no I/O.
 */

import { round1 } from './grade'
import type { BrandMatcher } from './brand-matcher'
import type {
  EngineAnswer,
  SentimentAssessment,
  SentimentLabel,
  SentimentSummary,
} from './types'

/** Favourable framing cues. Weighted equally; presence is what matters. */
const POSITIVE_CUES = [
  'best', 'top', 'leading', 'excellent', 'outstanding', 'highly rated',
  'highly recommended', 'recommended', 'trusted', 'reliable', 'strong',
  'well-regarded', 'well regarded', 'reputable', 'award-winning', 'award winning',
  'great', 'popular', 'preferred', 'standout', 'specializes', 'specialises',
  'known for', 'praised', 'favorable', 'favourable', 'competitive pricing',
  'good choice', 'solid', 'comprehensive', 'expertise', 'accredited',
]

/** Unfavourable framing cues. */
const NEGATIVE_CUES = [
  'poor', 'worst', 'complaints', 'complaint', 'lawsuit', 'lawsuits', 'fined',
  'penalt', 'scam', 'fraud', 'misleading', 'deceptive', 'unreliable',
  'disappointing', 'criticized', 'criticised', 'criticism', 'negative reviews',
  'low rating', 'low ratings', 'poorly rated', 'avoid', 'beware', 'declined',
  'denied claims', 'slow to respond', 'expensive', 'overpriced', 'hidden fees',
  'bad reviews', 'issues with', 'problems with', 'struggles', 'downgrade',
]

/** Cues that mark an explicit caveat next to otherwise positive framing. */
const HEDGE_CUES = ['however', 'but ', 'although', 'that said', 'on the downside', 'drawback', 'downside']

const LABEL_SCORE: Record<SentimentLabel, number> = {
  positive: 1,
  mixed: 0.6,
  neutral: 0.5,
  negative: 0,
  unknown: 0.5,
}

function countCues(haystack: string, cues: string[]): number {
  let n = 0
  for (const cue of cues) {
    if (haystack.includes(cue)) n += 1
  }
  return n
}

/**
 * Classify how one answer frames the brand. Returns 'unknown' with
 * confidence 0 when the brand is not named in the visible body.
 */
export function classifyAnswerSentiment(
  answer: EngineAnswer,
  matcher: BrandMatcher
): SentimentAssessment {
  if (answer.error !== null || !answer.answerText) {
    return { sentiment: 'unknown', confidence: 0 }
  }
  const snippet = matcher.snippet(answer.answerText, 260)
  if (!snippet) return { sentiment: 'unknown', confidence: 0 }

  const lower = snippet.toLowerCase()
  const positive = countCues(lower, POSITIVE_CUES)
  const negative = countCues(lower, NEGATIVE_CUES)
  const hedged = countCues(lower, HEDGE_CUES) > 0

  // Confidence rises with evidence and saturates at 0.9 — a lexicon can
  // never honestly claim certainty.
  const evidence = positive + negative
  const confidence = evidence === 0 ? 0.4 : Math.min(0.9, 0.5 + 0.1 * evidence)

  if (positive > 0 && negative > 0) return { sentiment: 'mixed', confidence: round1(confidence) }
  if (negative > 0) return { sentiment: 'negative', confidence: round1(confidence) }
  if (positive > 0) {
    return { sentiment: hedged ? 'mixed' : 'positive', confidence: round1(confidence) }
  }
  return { sentiment: 'neutral', confidence: 0.4 }
}

/**
 * Aggregate sentiment across every answer that names the brand.
 * `analyzed === 0` yields 'unknown' — reported, never fatal.
 */
export function summarizeSentiment(
  answers: EngineAnswer[],
  matcher: BrandMatcher
): SentimentSummary {
  const byLabel: Record<SentimentLabel, number> = {
    positive: 0, neutral: 0, negative: 0, mixed: 0, unknown: 0,
  }

  let confidenceTotal = 0
  let analyzed = 0

  try {
    for (const answer of answers) {
      const { sentiment, confidence } = classifyAnswerSentiment(answer, matcher)
      byLabel[sentiment] += 1
      if (sentiment === 'unknown') continue
      analyzed += 1
      confidenceTotal += confidence
    }
  } catch (e) {
    return {
      sentiment: 'unknown',
      confidence: 0,
      analyzed: 0,
      byLabel,
      error: e instanceof Error ? e.message : 'sentiment classification failed',
    }
  }

  if (analyzed === 0) {
    return { sentiment: 'unknown', confidence: 0, analyzed: 0, byLabel, error: null }
  }

  const { positive, negative, mixed, neutral } = byLabel
  let sentiment: SentimentLabel
  if (mixed > 0 || (positive > 0 && negative > 0)) sentiment = 'mixed'
  else if (negative > positive) sentiment = 'negative'
  else if (positive > neutral) sentiment = 'positive'
  else if (positive > 0) sentiment = 'positive'
  else sentiment = 'neutral'

  return {
    sentiment,
    confidence: round1(confidenceTotal / analyzed),
    analyzed,
    byLabel,
    error: null,
  }
}

/**
 * Mean favourability in [0, 1] across analysed answers — the number the
 * scoring engine converts into the 15-point Brand Sentiment category.
 * Returns null when nothing could be analysed.
 */
export function sentimentIndex(summary: SentimentSummary): number | null {
  if (summary.analyzed === 0) return null
  const labels: SentimentLabel[] = ['positive', 'neutral', 'negative', 'mixed']
  let total = 0
  for (const label of labels) total += LABEL_SCORE[label] * summary.byLabel[label]
  return total / summary.analyzed
}
