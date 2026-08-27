/**
 * Public-response sanitizer (Phase 3, Task 19).
 *
 * `GraderReport` as persisted (and as produced by lib/grader/analyzer.ts)
 * carries some fields that are genuinely useful to keep in the database
 * for debugging/cost-accounting but must NEVER reach a public API
 * response:
 *
 *   - `usage` — internal request/LLM-call counts and estimated cost.
 *   - `warnings[]` — free-text diagnostic strings that can embed raw
 *     provider error text, including (before this module existed) the
 *     actual dollar spend/cap from a DataForSeoCapExceededError.
 *   - `queries[].per[].error` / `.costUsd` — same class of leak, scoped to
 *     one engine answer.
 *
 * Neither `usage` nor `warnings` is read by any Phase 2 UI component
 * (verified by grep — grep -rn '\.warnings\b|\.usage\b' components/grader
 * lib/grader returns nothing outside this file's own doc comments), so
 * they are dropped entirely rather than redacted-in-place.
 * `per[].error`'s *presence* (null vs non-null) DOES drive frontend logic
 * (lib/grader/format.ts's aggregateEnginePresence excludes failed calls),
 * so it is replaced with a fixed generic string rather than removed.
 *
 * Pure, dependency-free (no Supabase import) — safe to unit test in
 * isolation, and safe to call from both the report route and, if ever
 * needed, a future export/webhook path.
 */

import type { EngineAnswer, GraderReport, QueryAnalysisResult } from './types'

/** Fixed replacement — never the real provider/cap message. */
const REDACTED_ERROR = 'unavailable'

function sanitizeEngineAnswer(answer: EngineAnswer): EngineAnswer {
  return {
    ...answer,
    costUsd: null,
    error: answer.error === null ? null : REDACTED_ERROR,
  }
}

function sanitizeQuery(query: QueryAnalysisResult): QueryAnalysisResult {
  return {
    ...query,
    per: query.per.map(sanitizeEngineAnswer),
  }
}

/**
 * The exact shape GET /api/grader/report/[id] returns to the public.
 * `usage` and `warnings` are omitted (not present as `undefined` keys —
 * `Omit` below, so a client can't even observe their absence-vs-null).
 */
export type PublicGraderReport = Omit<GraderReport, 'usage' | 'warnings'>

export function toPublicGraderReport(report: GraderReport): PublicGraderReport {
  return {
    company: report.company,
    score: report.score,
    queries: report.queries.map(sanitizeQuery),
    competitors: report.competitors,
    citations: report.citations,
    sentiment: { ...report.sentiment, error: null },
    readiness: report.readiness,
    recommendations: report.recommendations,
    summary: report.summary,
    // `usage` and `warnings` are intentionally absent — see the module
    // and PublicGraderReport doc comments above.
  }
}
