/**
 * Grader-specific daily budget guard (Phase 3, Task 10).
 *
 * WHY THIS EXISTS: the grader's three answer-engine calls run through
 * lib/dataforseo.ts, which shares ONE `DATAFORSEO_DAILY_CAP` with the
 * internal product — and that shared cap isn't even consistently
 * enforced across the grader's own engines: `fetchLlmResponse`
 * (perplexity/claude — 2 of the grader's 3 engines) never calls
 * `assertUnderCap()` at all; only the on-page-audit and chat_gpt paths
 * do. A public traffic spike could burn the internal team's daily budget
 * with no grader-side ceiling and no consistent enforcement to catch it.
 *
 * Rather than reworking lib/dataforseo.ts's cap plumbing (a bigger,
 * riskier change than Phase 3's "harden, don't rearchitect" scope), this
 * is an independent, additive guard: a simple daily RUN COUNT, checked
 * BEFORE a row is created (so a blocked request costs nothing — no DB
 * write, no DataForSEO call). Run count, not a dollar figure, on purpose:
 * `estimated_cost` is nullable whenever a provider doesn't report cost
 * (lib/grader/types.ts UsageStats), so a dollar-sum guard could silently
 * under-count and never trip. A run count can't be null.
 *
 * Fails OPEN on a counting error (lib/grader/store.ts
 * countGraderRunsSince) — a transient Supabase hiccup degrades to "no
 * guard today", not "grader is down today". That is a deliberate
 * trade-off for a public marketing tool, documented here and in the
 * Phase 3 report, not a silent gap.
 */

const DEFAULT_DAILY_RUN_LIMIT = 300

export function getGraderDailyRunLimit(): number {
  const raw = process.env.GRADER_DAILY_RUN_LIMIT
  if (!raw) return DEFAULT_DAILY_RUN_LIMIT
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_DAILY_RUN_LIMIT
}

/** Midnight UTC for `now` — a stable, timezone-unambiguous "today" boundary. */
export function startOfUtcDayIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

export interface GraderBudgetStatus {
  allowed: boolean
  /** Never sent to the client — logged server-side only (Task 10: "do not expose... internal cap configuration"). */
  limit: number
  runsToday: number
}

/**
 * `countRunsSince` is injected so this stays unit-testable without a
 * Supabase client — pass lib/grader/store.ts's `countGraderRunsSince` in
 * production code.
 */
export async function checkGraderDailyBudget(
  countRunsSince: (sinceIso: string) => Promise<number>,
  now: Date = new Date()
): Promise<GraderBudgetStatus> {
  const limit = getGraderDailyRunLimit()
  const runsToday = await countRunsSince(startOfUtcDayIso(now))
  return { allowed: runsToday < limit, limit, runsToday }
}

/** The ONLY thing a public caller ever sees when the budget is exhausted. */
export const BUDGET_EXHAUSTED_MESSAGE = "We're unable to run another analysis right now. Please try again later."
