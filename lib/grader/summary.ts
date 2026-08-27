/**
 * Executive summary.
 *
 * A deterministic fallback ALWAYS runs first and is ALWAYS what gets
 * persisted if the optional LLM polish fails or is disabled — the summary
 * is a rendering of already-computed facts, never their source. The LLM
 * step (gated by GRADER_LLM_SUMMARY=true) is handed the exact same facts as
 * plain text and told only to rephrase them; if its output introduces a
 * number, name or claim that isn't already in the deterministic version, it
 * is rejected and the fallback is kept.
 */

import { fetchChatgptCompletion } from '../dataforseo'
import type { CompetitorResult, GraderReportCompany, QueryAnalysisResult, ScoreBreakdown } from './types'

export interface SummaryInput {
  company: GraderReportCompany
  score: ScoreBreakdown
  queries: QueryAnalysisResult[]
  competitors: CompetitorResult[]
}

/** Deterministic, always-correct summary built directly from report facts. */
export function buildDeterministicSummary(input: SummaryInput): string {
  const { company, score, queries, competitors } = input
  const mentioned = queries.filter((q) => q.brandMentioned).length
  const topCompetitor = competitors[0]

  const sentences: string[] = []
  sentences.push(
    `${company.companyName} scores ${score.overall}/100 (${score.grade}) for AI visibility in ${company.industry}${company.location ? ` (${company.location})` : ''}.`
  )
  sentences.push(
    `The brand was mentioned in ${mentioned} of ${queries.length} AI-search queries tested across ChatGPT, Perplexity and Claude.`
  )
  if (topCompetitor) {
    sentences.push(
      `The most visible competitor, ${topCompetitor.name}, appeared in ${topCompetitor.queriesPresent} queries (${topCompetitor.shareOfVoice}% share of voice).`
    )
  } else {
    sentences.push('No competing brand was consistently named across the tested queries.')
  }
  const weakest = [...score.categories].sort((a, b) => a.score / a.max - b.score / b.max)[0]
  if (weakest) {
    sentences.push(`The lowest-scoring area is ${weakest.label} (${weakest.score}/${weakest.max}).`)
  }
  return sentences.join(' ')
}

/**
 * Extract every number, brand name and category label that appears in the
 * deterministic summary — the closed set of facts the LLM is allowed to
 * mention. Used to validate its output before it is trusted.
 */
function factTokens(input: SummaryInput, deterministic: string): Set<string> {
  const tokens = new Set<string>()
  for (const m of deterministic.matchAll(/\d+(?:\.\d+)?/g)) tokens.add(m[0])
  tokens.add(input.company.companyName.toLowerCase())
  for (const c of input.competitors) tokens.add(c.name.toLowerCase())
  return tokens
}

/** True when every number the candidate mentions is one we already know about. */
function onlyKnownFacts(candidate: string, allowedNumbers: Set<string>): boolean {
  for (const m of candidate.matchAll(/\d+(?:\.\d+)?/g)) {
    if (!allowedNumbers.has(m[0])) return false
  }
  return true
}

/**
 * Optional single polish call. Returns the deterministic summary unchanged
 * on any failure, disagreement, or when disabled — this function can never
 * make the report say something the data doesn't support.
 */
export async function buildExecutiveSummary(
  input: SummaryInput
): Promise<{ summary: string; cost: number; calls: number; warning: string | null }> {
  const deterministic = buildDeterministicSummary(input)
  if (process.env.GRADER_LLM_SUMMARY !== 'true') {
    return { summary: deterministic, cost: 0, calls: 0, warning: null }
  }

  const prompt =
    `Rewrite these facts as one polished, factual paragraph (max 60 words). ` +
    `Do not add any company, competitor, score or number not already present. ` +
    `Facts: ${deterministic}`.slice(0, 500)

  try {
    const res = await fetchChatgptCompletion(prompt)
    const candidate = res.text.trim()
    const allowedNumbers = factTokens(input, deterministic)

    if (!candidate || candidate.length > 500 || !onlyKnownFacts(candidate, allowedNumbers)) {
      return {
        summary: deterministic,
        cost: res.cost,
        calls: 1,
        warning: 'LLM summary rejected (introduced unverified facts) — used deterministic summary',
      }
    }
    return { summary: candidate, cost: res.cost, calls: 1, warning: null }
  } catch (e) {
    return {
      summary: deterministic,
      cost: 0,
      calls: 1,
      warning: `LLM summary failed (${e instanceof Error ? e.message : 'unknown error'}) — used deterministic summary`,
    }
  }
}
