/**
 * POST /api/grader/analyze — public entry point for the ProGrowth AI
 * Grader. Thin by design (Task 19): every real decision — normalisation,
 * query generation, provider calls, scoring, recommendations — lives in
 * lib/grader/*; this route only validates, runs the orchestrator, and
 * persists.
 *
 * RUNTIME MODEL — read before changing maxDuration:
 * The internal product's longest job (matomo-analysis) already runs as one
 * synchronous 300s Vercel function with no queue (vercel.json). This route
 * follows the same, proven pattern rather than pretending to be async: it
 * runs the FULL analysis in this one request and returns the FINAL status,
 * not always 'processing'. A "202 Accepted, poll for status" flow would
 * need a background worker or queue (Vercel Queues, a cron-polled job
 * table, …) that this repo does not have — building one is real Phase 2/3
 * infrastructure work, not a Phase 1 route detail. lib/grader/analyzer.ts
 * enforces its own internal deadline (ANSWER_DEADLINE_MS) well under this
 * route's 300s ceiling so the function always finishes and persists a
 * result rather than being killed mid-flight by the platform.
 *
 * GET /api/grader/report/[id] still works exactly as specified — it is
 * what a client polls/shares afterwards, and would start reporting genuine
 * 'processing' rows the moment a real queue is added behind this route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { normalizeGraderInput } from '@/lib/grader/normalize'
import { createGraderRun, completeGraderRun, countGraderRunsSince } from '@/lib/grader/store'
import { runGraderAnalysis } from '@/lib/grader/analyzer'
import { clientKeyFromHeaders, isRateLimited, isDuplicateSubmission } from '@/lib/grader/rate-limit'
import { checkGraderDailyBudget, BUDGET_EXHAUSTED_MESSAGE } from '@/lib/grader/spend-guard'
import { assertGraderEnv, GraderEnvError } from '@/lib/grader/env'
import { categorizeFailure } from '@/lib/grader/error-category'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Reject absurdly large bodies before even parsing them. */
const MAX_BODY_BYTES = 10_000

export async function POST(req: NextRequest) {
  try {
    assertGraderEnv()
  } catch (e) {
    // The detailed missing-variable list is exactly what an operator needs
    // and exactly what a public caller must never see (Task 5).
    console.error('[grader/analyze]', e instanceof GraderEnvError ? e.message : e)
    return NextResponse.json({ error: 'The grader is temporarily unavailable. Please try again later.' }, { status: 500 })
  }

  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
  }

  const clientKey = clientKeyFromHeaders(req.headers)
  if (isRateLimited(clientKey)) {
    return NextResponse.json(
      { error: 'Too many requests — please try again in a minute.' },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }

  const normalized = normalizeGraderInput(body)
  if (!normalized.ok) {
    return NextResponse.json(
      { error: 'Invalid input', issues: normalized.issues },
      { status: 400 }
    )
  }

  // Task 14 — same client, same domain, within a short window: almost
  // certainly a double-click/refresh, not a genuine second request.
  if (isDuplicateSubmission(clientKey, normalized.value.domain)) {
    return NextResponse.json(
      { error: 'An analysis for this website was just started. Please wait a moment before trying again.' },
      { status: 429 }
    )
  }

  // Task 10 — the grader's own budget ceiling, checked BEFORE any row is
  // created or any DataForSEO cost is spent. Never reveals the limit or
  // count to the caller (BUDGET_EXHAUSTED_MESSAGE is fixed and generic).
  const budget = await checkGraderDailyBudget(countGraderRunsSince)
  if (!budget.allowed) {
    console.warn(`[grader/analyze] daily budget exhausted: ${budget.runsToday}/${budget.limit} runs today`)
    return NextResponse.json({ error: BUDGET_EXHAUSTED_MESSAGE }, { status: 503 })
  }

  let reportId: string
  try {
    const run = await createGraderRun(normalized.value)
    reportId = run.reportId
  } catch (e) {
    console.error('[grader/analyze] failed to create run:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not start analysis — please try again.' }, { status: 500 })
  }

  const startedAt = Date.now()
  console.log(`[grader/analyze] ${reportId} start domain=${normalized.value.domain}`)

  try {
    const outcome = await runGraderAnalysis(normalized.value)
    await completeGraderRun(reportId, outcome.status, outcome.report, outcome.error)

    console.log(
      `[grader/analyze] ${reportId} ${outcome.status} domain=${normalized.value.domain} ` +
        `queries=${outcome.report?.queries.length ?? 0} ` +
        `dfsRequests=${outcome.report?.usage.dataforseoRequests ?? 0} ` +
        `llmCalls=${outcome.report?.usage.llmCalls ?? 0} durationMs=${Date.now() - startedAt}` +
        (outcome.status === 'failed' ? ` failureCategory=${categorizeFailure(outcome.error)}` : '')
    )

    if (outcome.status === 'failed') {
      return NextResponse.json({ reportId, status: outcome.status, error: outcome.error }, { status: 200 })
    }
    return NextResponse.json({ reportId, status: outcome.status })
  } catch (e) {
    // Anything unexpected still gets a sanitised, persisted failure — a run
    // must never be left stuck at 'processing' with no explanation.
    const message = e instanceof Error ? e.message : 'Analysis failed unexpectedly'
    console.error(
      `[grader/analyze] ${reportId} failed: ${message} failureCategory=${categorizeFailure(message)}`
    )
    try {
      await completeGraderRun(reportId, 'failed', null, 'Analysis could not be completed.')
    } catch (persistErr) {
      console.error(`[grader/analyze] ${reportId} ALSO failed to persist failure:`, persistErr)
    }
    return NextResponse.json(
      { reportId, status: 'failed', error: 'Analysis could not be completed.' },
      { status: 200 }
    )
  }
}
