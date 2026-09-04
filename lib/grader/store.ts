/**
 * Supabase persistence for the public AI Grader.
 *
 * Reuses the shared service-role client from lib/supabase.ts — no new
 * connection, no new credentials. Writes/reads ONLY `public_grader_runs`
 * (migrations/006_public_grader_runs.sql); this module never touches
 * `clients` or `analyses`.
 */

import { supabase } from '../supabase'
import type {
  GraderReport,
  GraderRun,
  GraderRunStatus,
  NormalizedGraderInput,
} from './types'

const TABLE = 'public_grader_runs'

export interface CreateRunResult {
  reportId: string
}

/** Insert the initial `processing` row for a just-accepted submission. */
export async function createGraderRun(input: NormalizedGraderInput): Promise<CreateRunResult> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      company_name: input.companyName,
      domain: input.domain,
      industry: input.industry,
      service: input.service,
      location: input.location,
      status: 'processing',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create grader run: ${error?.message ?? 'no row returned'}`)
  }
  return { reportId: data.id }
}

/** Persist a finished (completed/partial/failed) report. */
export async function completeGraderRun(
  reportId: string,
  status: Extract<GraderRunStatus, 'completed' | 'partial' | 'failed'>,
  report: GraderReport | null,
  errorMessage: string | null
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({
      status,
      error_message: errorMessage,
      overall_score: report?.score.overall ?? null,
      visibility_score: report?.score.visibility ?? null,
      citation_score: report?.score.citation ?? null,
      sentiment_score: report?.score.sentiment ?? null,
      competitive_score: report?.score.competitive ?? null,
      coverage_score: report?.score.coverage ?? null,
      readiness_score: report?.score.readiness ?? null,
      queries: report?.queries.map((q) => ({ query: q.query, category: q.category, priority: q.priority })) ?? [],
      query_results: report?.queries ?? [],
      competitors: report?.competitors ?? [],
      citations: report?.citations ?? {},
      recommendations: report?.recommendations ?? [],
      summary: report?.summary ?? null,
      raw_analysis: report,
      dataforseo_requests: report?.usage.dataforseoRequests ?? 0,
      llm_calls: report?.usage.llmCalls ?? 0,
      estimated_cost: report?.usage.estimatedCostUsd ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', reportId)

  if (error) {
    // Nothing left to fall back to — this IS the persistence step — but the
    // caller must not throw a stack trace at a public client, so this is
    // surfaced to the server logs and swallowed by the runner route.
    throw new Error(`Failed to persist grader report ${reportId}: ${error.message}`)
  }
}

function rowToRun(row: any): GraderRun {
  return {
    reportId: row.id,
    status: row.status,
    report: row.raw_analysis ?? null,
    error: row.error_message ?? null,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? null,
  }
}

/** Fetch a run by id for the retrieval endpoint. Returns null when not found. */
export async function getGraderRun(reportId: string): Promise<GraderRun | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, status, raw_analysis, error_message, created_at, completed_at')
    .eq('id', reportId)
    .maybeSingle()

  if (error || !data) return null
  return rowToRun(data)
}

/** True when a report with this id exists — POST /api/grader/lead checks
 *  this before writing so a lead can never be attached to a made-up id. */
export async function graderRunExists(reportId: string): Promise<boolean> {
  const { data, error } = await supabase.from(TABLE).select('id').eq('id', reportId).maybeSingle()
  return !error && !!data
}

/**
 * Count of runs created since `sinceIso` — the read behind the grader's
 * daily spend/run guard (lib/grader/spend-guard.ts, Task 10). Uses a
 * `head: true` count-only query (Supabase/PostgREST `Prefer: count=exact`)
 * so this never pulls report rows over the wire just to count them.
 *
 * FAILS OPEN (returns 0) on a Supabase error rather than blocking every
 * submission because the count query itself hiccuped — a transient
 * counting failure should not become a full outage. This mirrors the
 * documented trade-off, not an oversight; see spend-guard.ts.
 */
export async function countGraderRunsSince(sinceIso: string): Promise<number> {
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceIso)

  if (error) {
    console.error('[grader/store] countGraderRunsSince failed — failing open (treated as 0):', error.message)
    return 0
  }
  return count ?? 0
}

/**
 * Attach captured lead details to an existing run (Phase 2, Task 26).
 * Deliberately does NOT touch `status`/`raw_analysis`/scores — this is an
 * additive write onto migrations/007's columns only.
 */
export async function saveGraderLead(reportId: string, name: string, email: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .update({
      contact_name: name,
      email,
      email_captured_at: new Date().toISOString(),
    })
    .eq('id', reportId)

  if (error) {
    throw new Error(`Failed to save lead for report ${reportId}: ${error.message}`)
  }
}
