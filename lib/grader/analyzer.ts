/**
 * Grader analysis orchestrator — the ONLY place that wires every stage of
 * the pipeline together. API routes stay thin: they validate/dispatch and
 * persist, all business logic lives here (see Task 19 in the Phase 1 spec).
 *
 *   validate/normalize (caller — lib/grader/normalize.ts, already done by
 *                        the time this runs)
 *   → generate queries
 *   → run DataForSEO (3 answer engines × N queries)
 *   → normalize results
 *   → analyze brand visibility / discover competitors / analyze citations
 *   → run sentiment
 *   → run readiness checks
 *   → calculate scores
 *   → generate recommendations
 *   → generate summary
 *   (→ persist — done by the caller, lib/grader/store.ts, so this module
 *      stays a pure-ish function of its input and is easy to test)
 *
 * PARTIAL SUCCESS: readiness and sentiment can fail independently without
 * failing the run — the query/citation/scoring stages just treat a failed
 * sub-check as absent evidence (see readiness.ts / sentiment.ts). The run
 * only fails outright when NO engine produced a single usable answer, i.e.
 * there is no report to show at all.
 */

import { createBrandMatcher } from './brand-matcher'
import { fetchAllGraderAnswers, GRADER_ENGINES } from './dataforseo'
import { generateQueries } from './query-generator'
import { buildQueryResults } from './query-results'
import { aggregateCitations } from './citations'
import { aggregateCompetitors } from './competitors'
import { summarizeSentiment } from './sentiment'
import { auditGraderReadiness } from './readiness'
import { computeScore } from './scoring'
import { buildGraderRecommendations } from './recommendations'
import { buildExecutiveSummary } from './summary'
import type { GraderReport, GraderRunStatus, NormalizedGraderInput } from './types'

export interface AnalysisOutcome {
  status: Extract<GraderRunStatus, 'completed' | 'partial' | 'failed'>
  report: GraderReport | null
  error: string | null
}

/** Bounded concurrency across the (query × engine) fan-out — see lib/grader/dataforseo.ts. */
const ANSWER_CONCURRENCY = 4

/**
 * Wall-clock budget for the answer-engine fan-out. POST /api/grader/analyze
 * (app/api/grader/analyze/route.ts) is configured with `maxDuration = 300`;
 * this leaves ~70s of headroom for readiness checks, scoring, the summary
 * call and the Supabase write so the function always finishes and persists
 * a result instead of being killed mid-flight by the platform.
 *
 * That headroom assumes the optional GRADER_LLM_QUERIES / GRADER_LLM_SUMMARY
 * enrichment calls stay OFF (the launch default) — each goes through a
 * DataForSEO call with its own 90s worst-case timeout (see
 * DFS_CALL_TIMEOUT_MS in lib/dataforseo.ts), which would eat into or exceed
 * this buffer if ever turned on. Lower this constant first if either flag
 * is enabled.
 */
const ANSWER_DEADLINE_MS = 230_000

export async function runGraderAnalysis(input: NormalizedGraderInput): Promise<AnalysisOutcome> {
  const startedAt = Date.now()
  const warnings: string[] = []
  const matcher = createBrandMatcher({ companyName: input.companyName, domain: input.domain })

  // ── 1. Query generation (never throws — template set alone is complete) ──
  const queryPlan = await generateQueries(input)
  if (queryPlan.warning) warnings.push(queryPlan.warning)

  // ── 2. Answer-engine fan-out ──────────────────────────────────────────
  const answers = await fetchAllGraderAnswers(
    queryPlan.queries.map((q) => q.query),
    matcher,
    { concurrency: ANSWER_CONCURRENCY, engines: GRADER_ENGINES, deadlineMs: ANSWER_DEADLINE_MS }
  )

  // ── completed / partial / failed policy (Phase 3, Task 18) ──────────────
  // failed:    not enough core analysis exists for a meaningful report —
  //            the ONLY case is zero successful engine answers (nothing to
  //            score, no queries to show, no citations to derive).
  // partial:   core analysis succeeded (at least one usable answer) but a
  //            secondary source/check failed — one engine call failed on
  //            some query, readiness couldn't fully evaluate, or sentiment
  //            couldn't classify anything. See the final status decision
  //            below for the exact conditions.
  // completed: core analysis succeeded AND every secondary check ran
  //            cleanly. Every category above 'completed' in this list is a
  //            successively broader definition of "still a real report."
  const succeeded = answers.filter((a) => a.error === null)
  if (succeeded.length === 0) {
    const sampleError = answers.find((a) => a.error)?.error ?? 'no answer engine returned a usable response'
    return {
      status: 'failed',
      report: null,
      error: `Analysis could not be completed: ${sampleError}`,
    }
  }
  for (const failed of answers.filter((a) => a.error !== null)) {
    warnings.push(`${failed.engine} failed for "${failed.query}": ${failed.error}`)
  }

  // ── 3. Per-query rollup ────────────────────────────────────────────────
  const queryResults = buildQueryResults(queryPlan.queries, answers, matcher)

  // ── 4. Citations ───────────────────────────────────────────────────────
  const citations = aggregateCitations(answers, matcher)

  // ── 5. Competitors ─────────────────────────────────────────────────────
  const brandMentionCount = answers.filter((a) => a.error === null && a.brandMentioned).length
  const { competitors, totalCompetitorMentions } = aggregateCompetitors(answers, brandMentionCount)

  // ── 6. Sentiment (secondary — can degrade to 'unknown', never throws) ──
  const sentiment = summarizeSentiment(answers, matcher)
  if (sentiment.error) warnings.push(`sentiment: ${sentiment.error}`)

  // ── 7. AI readiness (secondary — degrades to partial/unavailable) ──────
  const readiness = await auditGraderReadiness(input.homepageUrl, matcher)
  if (readiness.error) warnings.push(`readiness: ${readiness.error}`)
  if (readiness.status !== 'ok') {
    warnings.push(`readiness: ${readiness.status} (${readiness.evaluatedCount}/${readiness.checks.length} checks evaluated)`)
  }

  // ── 8. Deterministic scoring ────────────────────────────────────────────
  const score = computeScore({
    queries: queryResults,
    citations,
    sentiment,
    competitors,
    brandMentionCount,
    totalCompetitorMentions,
    readiness,
  })

  // ── 9. Recommendations ──────────────────────────────────────────────────
  const recommendations = buildGraderRecommendations({
    score,
    queries: queryResults,
    citations,
    competitors,
    readiness,
    companyName: input.companyName,
  })

  // ── 10. Executive summary ───────────────────────────────────────────────
  const company = {
    companyName: input.companyName,
    domain: input.domain,
    industry: input.industry,
    service: input.service,
    location: input.location,
  }
  const summaryResult = await buildExecutiveSummary({ company, score, queries: queryResults, competitors })
  if (summaryResult.warning) warnings.push(summaryResult.warning)

  // ── Usage / cost ─────────────────────────────────────────────────────────
  const answerCost = answers.reduce((sum, a) => sum + (a.costUsd ?? 0), 0)
  const totalCost = answerCost + queryPlan.cost + summaryResult.cost
  const llmCalls = answers.length + queryPlan.calls + summaryResult.calls

  const report: GraderReport = {
    company,
    score,
    queries: queryResults,
    competitors,
    citations,
    sentiment,
    readiness,
    recommendations,
    summary: summaryResult.summary,
    usage: {
      dataforseoRequests: answers.length,
      llmCalls,
      estimatedCostUsd: totalCost > 0 ? Math.round(totalCost * 10_000) / 10_000 : null,
      durationMs: Date.now() - startedAt,
    },
    warnings,
  }

  // partial when: any individual engine call failed on any query, OR
  // readiness didn't fully evaluate, OR sentiment classification itself
  // errored (not merely "found nothing to classify" — see
  // lib/grader/sentiment.ts, analyzed === 0 is a normal, non-error
  // outcome and does NOT trigger partial on its own).
  const failedAnswers = answers.length - succeeded.length
  const status: AnalysisOutcome['status'] =
    failedAnswers > 0 || readiness.status !== 'ok' || sentiment.error ? 'partial' : 'completed'

  return { status, report, error: null }
}
