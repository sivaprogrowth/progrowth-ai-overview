/**
 * Reads the latest citation network snapshots from Supabase and assembles
 * the cluster × engine matrix for the dashboard.
 *
 * Each `__citation_network_snapshot__` row carries data for ONE cluster
 * (because we run clusters one-at-a-time to stay under Vercel Hobby's 60s
 * function timeout). The fetcher picks the latest row per cluster_id and
 * merges them into a single matrix.
 *
 * Multi-tenant: the snapshot is scoped to a Client. The fetcher filters
 * Supabase rows by `client_id` and uses the client's verticals for
 * cluster name lookup. Legacy snapshots that carry only `progrowthAppearances`
 * (no `brandAppearances`) are normalised on read for back-compat — see
 * `readAppearances()`.
 */

import { getClustersForClient } from './prompts'
import { ALL_ENGINES, type DomainRank, type Engine } from './citationNetwork'
import type { Client } from './clients'

export interface CrossEngineTarget {
  clusterId: string
  clusterName: string
  domain: string
  engines: Engine[]
  engineCount: number
  totalHits: number
}

export type MentionType = 'recommended' | 'mentioned' | 'source-only' | 'negative'

export interface BrandAppearance {
  clusterId: string
  clusterName: string
  engine: Engine
  promptId: string
  prompt: string
  /** Latest sentiment classification, if /api/cron/sentiment has run since the citation network was last snapshotted. */
  sentiment?: {
    type: MentionType
    score: number
    reasoning: string
    snippet: string | null
    classifiedAt: string
  }
}

export interface CitationNetworkSnapshot {
  generatedAt: string | null
  promptsRun: number
  clustersCovered: string[]
  perCell: Record<string /* clusterId */, Record<Engine, DomainRank[]>>
  crossEngineTargets: CrossEngineTarget[]
  brandAppearances: BrandAppearance[]
  /** Latest sentiment snapshot timestamp, if any (null = none ever run) */
  sentimentClassifiedAt: string | null
}

interface StoredAppearance {
  clusterId: string
  engine: Engine
  promptId: string
  prompt: string
}

/**
 * Back-compat: reads either the new `brandAppearances` field or the legacy
 * `progrowthAppearances` field from a stored snapshot summary. Snapshots
 * written before Phase 1 of the multi-tenant migration only carry the
 * legacy name.
 */
function readAppearances(summary: any): StoredAppearance[] {
  if (Array.isArray(summary?.brandAppearances)) return summary.brandAppearances
  if (Array.isArray(summary?.progrowthAppearances)) return summary.progrowthAppearances
  return []
}

/**
 * Back-compat: every DomainRank carries `isClientBrand` going forward but
 * stored rows still have `isProgrowth`. Normalise on read so downstream
 * UI never has to branch.
 */
function normaliseDomainRanks(perCell: Record<string, Record<Engine, any[]>>): Record<string, Record<Engine, DomainRank[]>> {
  const out: Record<string, Record<Engine, DomainRank[]>> = {}
  for (const [clusterId, engines] of Object.entries(perCell)) {
    out[clusterId] = {} as Record<Engine, DomainRank[]>
    for (const [engine, ranks] of Object.entries(engines)) {
      out[clusterId][engine as Engine] = (ranks ?? []).map((r: any) => ({
        domain: r.domain,
        hits: r.hits,
        isClientBrand: r.isClientBrand ?? r.isProgrowth ?? false,
      }))
    }
  }
  return out
}

export async function fetchCitationNetworkSnapshot(client: Client): Promise<CitationNetworkSnapshot | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  // Pull recent snapshots for this client; pick the latest per cluster.
  // Capping at 50 is plenty because we re-run quarterly.
  const { data, error } = await supabase
    .from('analyses')
    .select('summary, keywords, created_at')
    .eq('client_id', client.id)
    .eq('domain', '__citation_network_snapshot__')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error || !data || data.length === 0) return null

  const clusters = getClustersForClient(client)
  const clusterNameById = new Map(clusters.map((c) => [c.id, c.name]))
  const latestPerCluster = new Map<string, { summary: any; created_at: string }>()
  let mostRecentAt: string | null = null

  for (const row of data) {
    const s = row.summary as any
    const perCellRaw = s?.perCell as Record<string, Record<Engine, any[]>> | undefined
    if (!perCellRaw) continue
    for (const clusterId of Object.keys(perCellRaw)) {
      // Only treat a cluster as present in THIS snapshot if its cell
      // actually has ≥1 cited domain in some engine. computeCitationNetwork
      // writes all cluster keys even for a single-cluster run (4 empty),
      // so without this an fsm-only snapshot would shadow every cluster —
      // breaking the latest-per-cluster merge of cluster-scoped runs and
      // inflating clustersCovered to a misleading "5/5".
      const cell = perCellRaw[clusterId]
      const hasData =
        !!cell && ALL_ENGINES.some((e) => Array.isArray(cell[e]) && cell[e].length > 0)
      if (!hasData) continue
      if (!latestPerCluster.has(clusterId)) {
        latestPerCluster.set(clusterId, { summary: s, created_at: row.created_at })
      }
    }
    if (!mostRecentAt || row.created_at > mostRecentAt) mostRecentAt = row.created_at
  }

  if (latestPerCluster.size === 0) return null

  const perCell: Record<string, Record<Engine, DomainRank[]>> = {}
  const allAppearances: BrandAppearance[] = []
  let promptsRun = 0
  const seenAppearance = new Set<string>()

  for (const [clusterId, { summary }] of latestPerCluster) {
    const normalised = normaliseDomainRanks(summary.perCell ?? {})
    const cellsForCluster = normalised[clusterId]
    if (cellsForCluster) perCell[clusterId] = cellsForCluster
    promptsRun = Math.max(promptsRun, summary.promptsRun ?? 0)
    for (const app of readAppearances(summary)) {
      if (app.clusterId !== clusterId) continue
      const key = `${app.clusterId}|${app.engine}|${app.promptId}`
      if (seenAppearance.has(key)) continue
      seenAppearance.add(key)
      allAppearances.push({
        clusterId: app.clusterId,
        clusterName: clusterNameById.get(app.clusterId) ?? app.clusterId,
        engine: app.engine,
        promptId: app.promptId,
        prompt: app.prompt,
      })
    }
  }

  // Cross-engine targets: for each cluster, which domains appear across 2+ engines
  const crossEngineTargets: CrossEngineTarget[] = []
  for (const clusterId of Object.keys(perCell)) {
    const engineMap = perCell[clusterId]
    const domainEngines = new Map<string, { engines: Set<Engine>; hits: number }>()
    for (const engine of ALL_ENGINES) {
      for (const rank of engineMap?.[engine] ?? []) {
        const existing = domainEngines.get(rank.domain) ?? { engines: new Set(), hits: 0 }
        existing.engines.add(engine)
        existing.hits += rank.hits
        domainEngines.set(rank.domain, existing)
      }
    }
    for (const [domain, info] of domainEngines) {
      if (info.engines.size >= 2) {
        crossEngineTargets.push({
          clusterId,
          clusterName: clusterNameById.get(clusterId) ?? clusterId,
          domain,
          engines: Array.from(info.engines).sort(),
          engineCount: info.engines.size,
          totalHits: info.hits,
        })
      }
    }
  }

  crossEngineTargets.sort(
    (a, b) =>
      b.engineCount - a.engineCount ||
      b.totalHits - a.totalHits ||
      a.clusterId.localeCompare(b.clusterId) ||
      a.domain.localeCompare(b.domain)
  )

  // Merge in latest sentiment classifications, if a snapshot exists.
  const sentimentSnapshot = await fetchLatestSentimentSnapshot(client)
  let sentimentClassifiedAt: string | null = null
  if (sentimentSnapshot) {
    sentimentClassifiedAt = sentimentSnapshot.classifiedAt
    const byKey = new Map(
      sentimentSnapshot.classifications.map((c) => [`${c.cluster}|${c.engine}|${c.promptId}`, c])
    )
    for (const app of allAppearances) {
      const c = byKey.get(`${app.clusterId}|${app.engine}|${app.promptId}`)
      if (c) {
        app.sentiment = {
          type: c.type,
          score: c.score,
          reasoning: c.reasoning,
          snippet: c.snippet ?? null,
          classifiedAt: sentimentSnapshot.classifiedAt,
        }
      }
    }
  }

  return {
    generatedAt: mostRecentAt,
    promptsRun,
    clustersCovered: Array.from(latestPerCluster.keys()),
    perCell,
    crossEngineTargets,
    brandAppearances: allAppearances,
    sentimentClassifiedAt,
  }
}

interface SentimentRow {
  promptId: string
  cluster: string
  engine: Engine
  type: MentionType
  score: number
  reasoning: string
  snippet: string | null
}

async function fetchLatestSentimentSnapshot(client: Client): Promise<{
  classifiedAt: string
  classifications: SentimentRow[]
} | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const { supabase } = await import('@/lib/supabase')

  const { data, error } = await supabase
    .from('analyses')
    .select('rows, created_at')
    .eq('client_id', client.id)
    .eq('domain', '__sentiment_snapshot__')
    .order('created_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const rows = (data[0].rows ?? []) as SentimentRow[]
  return { classifiedAt: data[0].created_at, classifications: rows }
}
