import { NextRequest, NextResponse } from 'next/server'
import { computeCitationNetwork, ALL_ENGINES, type Engine } from '@/lib/citationNetwork'
import { CANONICAL_PROMPTS } from '@/lib/prompts'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/citation-network
 *
 * Runs the per-engine citation network mapping across the 25 canonical
 * prompts × 4 engines = ~$7.25 in DataForSEO credits per full run.
 * Path lives under /api/cron so middleware's Bearer-token allowlist
 * applies — but this is a manually-triggered one-shot, not a scheduled
 * cron. Outlet rankings don't change week-over-week.
 *
 * Query params:
 *   ?engines=chatgpt,claude   limit to specific engines (cost control)
 *   ?clusters=fcmo,fsm        limit to specific clusters
 */
export async function GET(req: NextRequest) {

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
