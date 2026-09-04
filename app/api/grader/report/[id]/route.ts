/**
 * GET /api/grader/report/[id] — public retrieval endpoint for the
 * ProGrowth AI Grader. Thin: reads the persisted run and shapes the
 * response; no business logic here (lib/grader/store.ts owns the query).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getGraderRun } from '@/lib/grader/store'
import { isValidReportId } from '@/lib/grader/ids'
import { withStaleProcessingRecovery } from '@/lib/grader/stale-processing'
import { toPublicGraderReport } from '@/lib/grader/public-report'
import { requireValidProelevateAuthOrPublic } from '@/lib/grader/api-auth'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  // grader-api: same optional-Bearer design as the analyze route — see
  // lib/grader/api-auth.ts. A caller presenting a bad token is rejected
  // before the Supabase lookup below; the existing public report-sharing
  // flow (no token at all) is completely unaffected.
  const authError = requireValidProelevateAuthOrPublic(req.headers)
  if (authError) return authError

  const { id } = params
  if (!isValidReportId(id)) {
    return NextResponse.json({ error: 'Invalid report id' }, { status: 400 })
  }

  let run
  try {
    run = await getGraderRun(id)
  } catch (e) {
    console.error('[grader/report] lookup failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Could not load report — please try again.' }, { status: 500 })
  }

  if (!run) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  // Task 13 — a row abandoned mid-flight by the platform (deploy/OOM/hard
  // kill) never gets a second write; this is the read-time recovery for it.
  run = withStaleProcessingRecovery(run)

  switch (run.status) {
    case 'processing':
      return NextResponse.json({ reportId: run.reportId, status: run.status })
    case 'failed':
      return NextResponse.json({
        reportId: run.reportId,
        status: run.status,
        error: run.error ?? 'Analysis could not be completed.',
      })
    case 'completed':
    case 'partial':
      // Task 19 — never return usage/warnings/raw provider error text or
      // per-call cost to a public caller; report.raw_analysis in Supabase
      // keeps the full data for debugging, this response does not.
      return NextResponse.json({
        reportId: run.reportId,
        status: run.status,
        report: run.report ? toPublicGraderReport(run.report) : null,
      })
    default:
      return NextResponse.json({ error: 'Unknown report status' }, { status: 500 })
  }
}
