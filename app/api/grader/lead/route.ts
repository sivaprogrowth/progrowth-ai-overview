/**
 * POST /api/grader/lead — public lead capture for the AI Grader (Phase 2,
 * Task 27). Thin: validates, confirms the report exists, persists via
 * lib/grader/store.ts. No service-role credentials ever reach the client —
 * this route is the only thing that touches Supabase.
 */

import { NextRequest, NextResponse } from 'next/server'
import { normalizeLeadInput } from '@/lib/grader/lead'
import { graderRunExists, saveGraderLead } from '@/lib/grader/store'
import { clientKeyFromHeaders, isRateLimited } from '@/lib/grader/rate-limit'

export const runtime = 'nodejs'

const MAX_BODY_BYTES = 2_000

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get('content-length') ?? '0')
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 })
  }

  // Separate bucket from /api/grader/analyze (prefixed key) — submitting a
  // lead is a lighter, no-cost action and shouldn't share the same 5/min
  // budget as a full paid analysis run.
  const clientKey = `lead:${clientKeyFromHeaders(req.headers)}`
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

  const normalized = normalizeLeadInput(body)
  if (!normalized.ok) {
    return NextResponse.json({ error: 'Invalid input', issues: normalized.issues }, { status: 400 })
  }

  const { reportId, name, email } = normalized.value

  try {
    const exists = await graderRunExists(reportId)
    if (!exists) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }
    await saveGraderLead(reportId, name, email)
  } catch (e) {
    console.error('[grader/lead] failed to save lead:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: 'Could not save your details — please try again.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true })
}
