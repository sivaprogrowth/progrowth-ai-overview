/**
 * GET /api/grader/report/[id] — public retrieval endpoint for the
 * ProGrowth AI Grader. Thin: reads the persisted run and shapes the
 * response; no business logic here (lib/grader/store.ts owns the query).
 */

import { NextRequest, NextResponse } from 'next/server'
import { getGraderRun } from '@/lib/grader/store'
import { isValidReportId } from '@/lib/grader/ids'

export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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
      return NextResponse.json({ reportId: run.reportId, status: run.status, report: run.report })
    default:
      return NextResponse.json({ error: 'Unknown report status' }, { status: 500 })
  }
}
