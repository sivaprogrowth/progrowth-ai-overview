import { NextRequest, NextResponse } from 'next/server'
import { getClientFromRequest } from '@/lib/clientContext'
import { supabase } from '@/lib/supabase'
import type { Engine } from '@/lib/citationNetwork'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/cron/export-citations
 *
 * Machine-readable export of the latest citation-network observations for
 * one client, consumed by the GTM factory's citations mirror sync
 * (progrowth-gtm-factory scripts/mirrors/citations.ts). Lives under
 * /api/cron so middleware's Bearer allowlist (CRON_SECRET / BATCH_API_KEY)
 * applies.
 *
 * Response shape: { data: [{ citation_key, source, url, title, query,
 * engine, appearances, first_seen_at, last_seen_at }] } — field names the
 * factory's normalizeCitations() maps directly. `query` is the exact
 * canonical prompt text and `engine` is the shared engine slug; the
 * factory's I1 station joins observations to prompts by exact
 * lower(query) + engine match, so neither may be rewritten here.
 *
 * Snapshots are stored one-per-cluster (fan-out), so the latest row per
 * promptId across recent snapshots is the current observation set.
 */
export async function GET(req: NextRequest) {
  const client = await getClientFromRequest(req)

  const { data, error } = await supabase
    .from('analyses')
    .select('created_at, rows')
    .eq('domain', '__citation_network_snapshot__')
    .eq('client_id', client.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  interface PromptRow {
    promptId?: string
    query?: string
    citations?: Partial<Record<Engine, string[]>>
  }

  // Newest snapshot wins per prompt; older snapshots only fill prompts the
  // newer ones did not run (cluster-scoped runs cover disjoint prompt sets).
  const latestByPrompt = new Map<string, { row: PromptRow; observedAt: string }>()
  for (const snapshot of data ?? []) {
    for (const row of (snapshot.rows as PromptRow[] | null) ?? []) {
      if (!row?.promptId || !row.query) continue
      if (!latestByPrompt.has(row.promptId)) {
        latestByPrompt.set(row.promptId, { row, observedAt: snapshot.created_at })
      }
    }
  }

  const records: Array<Record<string, unknown>> = []
  for (const { row, observedAt } of latestByPrompt.values()) {
    for (const [engine, domains] of Object.entries(row.citations ?? {})) {
      for (const domain of domains ?? []) {
        records.push({
          citation_key: `${client.slug}:${row.promptId}:${engine}:${domain}`,
          source: 'aioverviews',
          url: `https://${domain}/`,
          title: null,
          query: row.query,
          engine,
          appearances: 1,
          first_seen_at: observedAt,
          last_seen_at: observedAt,
        })
      }
    }
  }

  return NextResponse.json({
    client: client.slug,
    prompts_covered: latestByPrompt.size,
    generated_at: new Date().toISOString(),
    data: records,
  })
}
