import { NextRequest, NextResponse } from 'next/server'
import { computeCitationNetwork, ALL_ENGINES, type Engine } from '@/lib/citationNetwork'
import { getPromptsForClient, getClustersForClient } from '@/lib/prompts'
import { getClientFromRequest } from '@/lib/clientContext'
import { fanOutToClients, fanOutValues, shouldFanOut } from '@/lib/cronFanout'
import type { Client } from '@/lib/clients'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/citation-network
 *
 * Runs the per-engine citation network mapping for the resolved client
 * across their canonical prompts × 5 engines (ChatGPT/Claude/Perplexity/
 * Gemini via DataForSEO + Grok via the xAI API). Cost ~$7.25 (DataForSEO)
 * + ~$0.75–$1.75 (Grok) per full run.
 *
 * Multi-tenant: resolves the client from ?client=<slug>, the client_slug
 * cookie, or falls back to the default ('progrowth') — see lib/clientContext.
 *
 * Query params:
 *   ?client=<slug>           pick which tenant to analyse
 *   ?engines=chatgpt,grok    limit to specific engines (cost control)
 *   ?clusters=fcmo,fsm       limit to specific clusters
 *
 * Path lives under /api/cron so middleware's Bearer-token allowlist
 * applies. Two levels of fan-out keep every sub-run under the 60s
 * Vercel function cap (a single full client run 504s):
 *   • no ?client=               → fan out per cron_enabled client
 *   • ?client= but no ?clusters= → fan out per cluster (one self-fetch
 *                                  each, ~5 prompts → < 60s); the fetcher
 *                                  merges the latest snapshot per cluster
 *   • ?client= & ?clusters=<id> → actually compute that cluster
 */
export async function GET(req: NextRequest) {
  if (shouldFanOut(req)) {
    return fanOutToClients(req, '/api/cron/citation-network')
  }
  const client = await getClientFromRequest(req)

  // Per-cluster fan-out: split a client into one sub-run per cluster so
  // none exceeds the 60s cap. Skipped when ?clusters= is already set
  // (that's the leaf that does the real work) or the client has ≤1
  // cluster (nothing to split).
  if (!req.nextUrl.searchParams.get('clusters')) {
    const clusterIds = getClustersForClient(client).map((c) => c.id)
    if (clusterIds.length > 1) {
      return fanOutValues(req, '/api/cron/citation-network', 'clusters', clusterIds)
    }
  }

  return runForClient(client, req)
}

async function runForClient(client: Client, req: NextRequest): Promise<NextResponse> {

  const engineFilter = req.nextUrl.searchParams.get('engines')
  const clusterFilter = req.nextUrl.searchParams.get('clusters')

  const engines: Engine[] = engineFilter
    ? (engineFilter.split(',').map((s) => s.trim()) as Engine[]).filter((e) =>
        ALL_ENGINES.includes(e)
      )
    : ALL_ENGINES

  const allPrompts = getPromptsForClient(client)
  const prompts = clusterFilter
    ? allPrompts.filter((p) => clusterFilter.split(',').map((s) => s.trim()).includes(p.cluster))
    : allPrompts

  const matrix = await computeCitationNetwork(client, prompts, engines)

  // Store snapshot in the analyses table using a sentinel domain so we
  // can read it back without needing a new table. client_id scopes the
  // row to the tenant; the legacy progrowthAppearances key is preserved
  // alongside brandAppearances for read-side back-compat.
  const { error } = await supabase.from('analyses').insert({
    email: client.notification_email ?? 'system@progrowth.services',
    domain: '__citation_network_snapshot__',
    client_id: client.id,
    keywords: prompts.map((p) => p.text),
    summary: {
      source: 'citation-network',
      promptsRun: matrix.promptsRun,
      engines: matrix.engines,
      brandAppearancesCount: matrix.brandAppearances.length,
      perCell: matrix.perCell,
      topByEngine: matrix.topByEngine,
      brandAppearances: matrix.brandAppearances,
      // Legacy aliases — kept so old fetcher code keeps working during cutover
      progrowthAppearancesCount: matrix.brandAppearances.length,
      progrowthAppearances: matrix.brandAppearances,
    },
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
    client: { id: client.id, slug: client.slug },
    stored: !error,
    storeError: error?.message ?? null,
  })
}
