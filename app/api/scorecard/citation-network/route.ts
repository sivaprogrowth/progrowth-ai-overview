import { NextRequest, NextResponse } from 'next/server'
import { computeCitationNetwork, ALL_ENGINES, type Engine } from '@/lib/citationNetwork'
import { CANONICAL_PROMPTS } from '@/lib/prompts'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/scorecard/citation-network
 *
 * Runs the per-engine citation network mapping across the 25 canonical
 * prompts × 4 engines = ~$7.25 in DataForSEO credits per full run.
 * Designed as a manually-triggered one-shot (not a cron) — outlet
 * rankings don't change week-over-week.
 *
 * Query params:
 *   ?engines=chatgpt,claude   limit to specific engines (cost control)
 *   ?clusters=fcmo,fsm        limit to specific clusters
 *
 * Auth via middleware (/api/scorecard not in the public allowlist, but
 * this path falls under /api/scorecard which requires Bearer or session
 * — for now this means session cookie OR we explicitly handle it here).
 * Actually middleware only allows /api/cron and /api/matomo via Bearer,
 * so we add explicit Bearer check here too.
 */
export async function GET(req: NextRequest) {
  // Explicit Bearer check — this path doesn't match middleware's
  // Bearer allowlist (which covers only /api/cron, /api/matomo,
  // /api/analyze/batch). Either session cookie OR explicit Bearer.
  const authHeader = req.headers.get('authorization')
  const hasValidBearer = authHeader?.startsWith('Bearer ') && (() => {
    const token = authHeader.slice(7)
    return token === process.env.BATCH_API_KEY || token === process.env.CRON_SECRET
  })()
  if (!hasValidBearer && !req.cookies.get('session')?.value) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const engineFilter = req.nextUrl.searchParams.get('engines')
  const clusterFilter = req.nextUrl.searchParams.get('clusters')

  const engines: Engine[] = engineFilter
    ? (engineFilter.split(',').map((s) => s.trim()) as Engine[]).filter((e) =>
        ALL_ENGINES.includes(e)
      )
    : ALL_ENGINES

  const prompts = clusterFilter
    ? CANONICAL_PROMPTS.filter((p) => clusterFilter.split(',').map((s) => s.trim()).includes(p.cluster))
    : CANONICAL_PROMPTS

  const matrix = await computeCitationNetwork(prompts, engines)

  // Store snapshot in the analyses table using a sentinel domain so we
  // can read it back without needing a new table.
  const { error } = await supabase.from('analyses').insert({
    email: 'system@progrowth.services',
    domain: '__citation_network_snapshot__',
    keywords: prompts.map((p) => p.text),
    summary: {
      source: 'citation-network',
      promptsRun: matrix.promptsRun,
      engines: matrix.engines,
      progrowthAppearancesCount: matrix.progrowthAppearances.length,
      perCell: matrix.perCell,
      topByEngine: matrix.topByEngine,
      progrowthAppearances: matrix.progrowthAppearances,
    },
    // perPrompt detail goes in rows so the summary stays scannable
    rows: matrix.perPrompt.map(({ prompt, citations }) => ({
      promptId: prompt.id,
      cluster: prompt.cluster,
      promptType: prompt.type,
      query: prompt.text,
      citations,
    })),
  })

  return NextResponse.json({
    ...matrix,
    stored: !error,
    storeError: error?.message ?? null,
  })
}
