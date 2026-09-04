/**
 * Grader analysis orchestrator — the ONLY place that wires every stage of
 * the pipeline together. API routes stay thin: they validate/dispatch and
 * persist, all business logic lives here (see Task 19 in the Phase 1 spec).
 *
 *   validate/normalize (caller — lib/grader/normalize.ts, already done by
 *                        the time this runs)
 *   → generate queries
 *   → run DataForSEO (3 answer engines × N queries)      ─┐
 *                                                          ├─ concurrent (Phase 1 perf work)
 *   → run readiness checks                                ┘
 *   → normalize results
 *   → analyze brand visibility / discover competitors / analyze citations
 *   → run sentiment
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
 *
 * PHASE 1 PERFORMANCE NOTE: AI readiness (three fetches against the
 * company's OWN site) has zero data dependency on the DataForSEO answers —
 * it only needs `input.homepageUrl` and `matcher`, both available before a
 * single query is even generated. The original implementation still
 * awaited it strictly after the entire DataForSEO fan-out finished, adding
 * its full duration on top of the fan-out's instead of overlapping with it.
 * It is now started immediately (right after the matcher is built) and only
 * AWAITED later, at the exact point in this function where its result was
 * already being consumed before — so the `warnings`/status logic below is
 * byte-for-byte unchanged; only the wall-clock moment the underlying
 * fetches actually run has moved earlier. See lib/grader/timing.ts for the
 * `[grader:timing]` stage logs this produces, and the Phase 1 performance
 * report for measured before/after numbers.
 */

import { createBrandMatcher } from './brand-matcher'
import { fetchAllGraderAnswers, GRADER_ENGINES } from './dataforseo'
import { getGraderProviderConcurrency } from './concurrency'
import { logGraderTiming, timedStage, timedSyncStage } from './timing'
import { generateQueries } from './query-generator'
import { buildQueryResults } from './query-results'
import { aggregateCitations } from './citations'
import { aggregateCompetitors } from './competitors'
import { summarizeSentiment } from './sentiment'
import { auditGraderReadiness } from './readiness'
import { computeScore } from './scoring'
import { buildGraderRecommendations } from './recommendations'
import { buildExecutiveSummary } from './summary'
import type { GraderReport, GraderRunStatus, NormalizedGraderInput, ReadinessResult } from './types'

export interface AnalysisOutcome {
  status: Extract<GraderRunStatus, 'completed' | 'partial' | 'failed'>
  report: GraderReport | null
  error: string | null
}

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

/**
 * `reportId` is used ONLY to correlate `[grader:timing]` log lines with the
 * Supabase row the caller already created — it is not otherwise read, so a
 * caller/test invoking this without one (the pre-Phase-1 signature) still
 * gets fully correct behavior, just with `reportId=unknown` in the logs.
 */
export async function runGraderAnalysis(
  input: NormalizedGraderInput,
  reportId = 'unknown'
): Promise<AnalysisOutcome> {
  const startedAt = Date.now()
  const warnings: string[] = []
  const matcher = createBrandMatcher({ companyName: input.companyName, domain: input.domain })

  // ── AI readiness — started NOW, not after the fan-out below (see the
  // PHASE 1 PERFORMANCE NOTE above). `.catch()` is attached at creation, not
  // at the `await` site, so this can never produce an unhandled-rejection
  // warning regardless of which code path below ends up consuming it (the
  // early 'failed' return never awaits it at all) — and a secondary
  // readiness failure can never reject this Promise.all-adjacent branch and
  // take the primary DataForSEO analysis down with it (Task 6).
  // auditGraderReadiness's own contract already says it never throws; this
  // is a second, independent safety net at the join point in case that
  // contract is ever violated by a future change.
  const readinessStartedAt = Date.now()
  const readinessPromise: Promise<ReadinessResult> = auditGraderReadiness(input.homepageUrl, matcher).catch(
    (e): ReadinessResult => ({
      status: 'unavailable',
      checks: [],
      passedCount: 0,
      evaluatedCount: 0,
      error: e instanceof Error ? e.message : 'readiness check failed unexpectedly',
    })
  )

  // ── 1. Query generation (never throws — template set alone is complete) ──
  const queryPlan = await timedStage(reportId, 'query-generation', () => generateQueries(input))
  if (queryPlan.warning) warnings.push(queryPlan.warning)

  // ── 2. Answer-engine fan-out ──────────────────────────────────────────
  const concurrency = getGraderProviderConcurrency()
  const { answers, engineStats } = await timedStage(reportId, 'dataforseo-fanout', () =>
    fetchAllGraderAnswers(
      queryPlan.queries.map((q) => q.query),
      matcher,
      { concurrency, engines: GRADER_ENGINES, deadlineMs: ANSWER_DEADLINE_MS }
    )
  )
  for (const stats of engineStats) {
    console.log(
      `[grader:timing] reportId=${reportId} stage=engine-${stats.engine} ` +
        `attempted=${stats.attempted} succeeded=${stats.succeeded} failed=${stats.failed} ` +
        `fastestMs=${stats.fastestMs ?? 'n/a'} slowestMs=${stats.slowestMs ?? 'n/a'} ` +
        `avgMs=${stats.avgMs ?? 'n/a'} wallClockSpanMs=${stats.wallClockSpanMs ?? 'n/a'}`
    )
  }

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
    // Readiness is already running (or done) in the background regardless —
    // log its timing when it settles, but don't make a fast, fully-failed
    // run (e.g. every call cap-exceeded instantly) wait around for it. This
    // is a deliberate latency choice: there is no report to attach a
    // readiness result to in this branch anyway.
    readinessPromise.then(() => logGraderTiming(reportId, 'readiness', Date.now() - readinessStartedAt))
    // Phase 3 fix: this used to interpolate the raw per-engine error text
    // (`sampleError`) directly into the value returned here — which
    // becomes BOTH the persisted `error_message` column AND, unsanitized,
    // GET /api/grader/report/[id]'s public `error` field (rendered
    // verbatim on the failed-report page by ReportView.tsx). A raw
    // EngineAnswer.error can carry a provider HTTP response body (see
    // lib/dataforseo.ts's dfsPost: `failed (${res.status}): ${text}`) or a
    // raw fetch/network error message — exactly the "provider stack
    // traces / raw provider errors" a public caller must never see. The
    // real reason is still fully visible server-side (log line below),
    // matching the existing pattern for other provider-detail leaks (see
    // DataForSeoCapExceededError's handling in lib/grader/dataforseo.ts).
    const sampleError = answers.find((a) => a.error)?.error ?? 'no answer engine returned a usable response'
    console.error(`[grader/analyzer] ${reportId} every engine call failed — sample: ${sampleError}`)
    return {
      status: 'failed',
      report: null,
      error: 'We could not complete this analysis. Please try again in a moment.',
    }
  }
  for (const failed of answers.filter((a) => a.error !== null)) {
    warnings.push(`${failed.engine} failed for "${failed.query}": ${failed.error}`)
  }

  // ── 3. Per-query rollup ────────────────────────────────────────────────
  const queryResults = timedSyncStage(reportId, 'query-rollup', () => buildQueryResults(queryPlan.queries, answers, matcher))

  // ── 4. Citations ───────────────────────────────────────────────────────
  const citations = timedSyncStage(reportId, 'citation-aggregation', () => aggregateCitations(answers, matcher))

  // ── 5. Competitors ─────────────────────────────────────────────────────
  const brandMentionCount = answers.filter((a) => a.error === null && a.brandMentioned).length
  const { competitors, totalCompetitorMentions } = timedSyncStage(reportId, 'competitor-extraction', () =>
    aggregateCompetitors(answers, brandMentionCount)
  )

  // ── 6. Sentiment (secondary — can degrade to 'unknown', never throws) ──
  const sentiment = timedSyncStage(reportId, 'sentiment', () => summarizeSentiment(answers, matcher))
  if (sentiment.error) warnings.push(`sentiment: ${sentiment.error}`)

  // ── 7. AI readiness (secondary — degrades to partial/unavailable) ──────
  // Initiated above, before query generation — this `await` almost always
  // resolves immediately here since the DataForSEO fan-out (steps above)
  // typically takes far longer than the three lightweight fetches readiness
  // runs. Consumption point and warnings logic are UNCHANGED from before
  // Phase 1: only the moment the underlying fetches started has moved.
  const readiness = await readinessPromise
  logGraderTiming(reportId, 'readiness', Date.now() - readinessStartedAt)
  if (readiness.error) warnings.push(`readiness: ${readiness.error}`)
  if (readiness.status !== 'ok') {
    warnings.push(`readiness: ${readiness.status} (${readiness.evaluatedCount}/${readiness.checks.length} checks evaluated)`)
  }

  // ── 8. Deterministic scoring ────────────────────────────────────────────
  const score = timedSyncStage(reportId, 'scoring', () =>
    computeScore({
      queries: queryResults,
      citations,
      sentiment,
      competitors,
      brandMentionCount,
      totalCompetitorMentions,
      readiness,
    })
  )

  // ── 9. Recommendations ──────────────────────────────────────────────────
  const recommendations = timedSyncStage(reportId, 'recommendations', () =>
    buildGraderRecommendations({
      score,
      queries: queryResults,
      citations,
      competitors,
      readiness,
      companyName: input.companyName,
    })
  )

  // ── 10. Executive summary ───────────────────────────────────────────────
  const company = {
    companyName: input.companyName,
    domain: input.domain,
    industry: input.industry,
    service: input.service,
    location: input.location,
  }
  const summaryResult = await timedStage(reportId, 'summary', () =>
    buildExecutiveSummary({ company, score, queries: queryResults, competitors })
  )
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

  logGraderTiming(reportId, 'total-analysis', Date.now() - startedAt)
  return { status, report, error: null }
}
