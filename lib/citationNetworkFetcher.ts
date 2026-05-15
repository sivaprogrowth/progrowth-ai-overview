/**
 * Reads the latest citation network snapshots from Supabase and assembles
 * the cluster × engine matrix for the dashboard.
 *
 * Each `__citation_network_snapshot__` row carries data for ONE cluster
 * (because we run clusters one-at-a-time to stay under Vercel Hobby's 60s
 * function timeout). The fetcher picks the latest row per cluster_id and
 * merges them into a single matrix.
 *
 * Also derives the "earned media gold" cross-engine rollups (domains
 * appearing in 2+ engines for the same cluster) since these drive the
 * Task 18 outreach sequence.
 */

import { PROMPT_CLUSTERS } from './prompts'
import { ALL_ENGINES, type DomainRank, type Engine } from './citationNetwork'

export interface CrossEngineTarget {
  clusterId: string
  clusterName: string
  domain: string
  engines: Engine[]
  engineCount: number
  totalHits: number
}

export interface ProgrowthAppearance {
  clusterId: string
  clusterName: string
  engine: Engine
  promptId: string
  prompt: string
}

export interface CitationNetworkSnapshot {
  generatedAt: string | null
  promptsRun: number
  clustersCovered: string[]
  perCell: Record<string /* clusterId */, Record<Engine, DomainRank[]>>
  crossEngineTargets: CrossEngineTarget[]
  progrowthAppearances: ProgrowthAppearance[]
}

export async function fetchCitationNetworkSnapshot(): Promise<CitationNetworkSnapshot | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const { supabase } = await import('@/lib/supabase')

  // Pull recent snapshots; we'll pick the latest per cluster client-side.
  // Capping at 50 is plenty because we re-run quarterly.
  const { data, error } = await supabase
    .from('analyses')
    .select('summary, keywords, created_at')
    .eq('domain', '__citation_network_snapshot__')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error || !data || data.length === 0) return null

  const clusterNameById = new Map(PROMPT_CLUSTERS.map((c) => [c.id, c.name]))
  const latestPerCluster = new Map<string, { summary: any; created_at: string }>()
  let mostRecentAt: string | null = null

  for (const row of data) {
    const s = row.summary as any
    const perCell = s?.perCell as Record<string, Record<Engine, DomainRank[]>> | undefined
    if (!perCell) continue
    // Each snapshot row carries only the clusters that were in that run; pick
    // the latest row per cluster slug.
    for (const clusterId of Object.keys(perCell)) {
      if (!latestPerCluster.has(clusterId)) {
        latestPerCluster.set(clusterId, { summary: s, created_at: row.created_at })
      }
    }
    if (!mostRecentAt || row.created_at > mostRecentAt) mostRecentAt = row.created_at
  }

  if (latestPerCluster.size === 0) return null

  // Assemble the merged matrix
  const perCell: Record<string, Record<Engine, DomainRank[]>> = {}
  const allAppearances: ProgrowthAppearance[] = []
  let promptsRun = 0
  const seenAppearance = new Set<string>()

  for (const [clusterId, { summary }] of latestPerCluster) {
    const cellsForCluster = summary.perCell?.[clusterId]
    if (cellsForCluster) perCell[clusterId] = cellsForCluster
    promptsRun = Math.max(promptsRun, summary.promptsRun ?? 0)
    for (const app of (summary.progrowthAppearances ?? []) as any[]) {
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

  crossEngineTargets.sort((a, b) =>
    b.engineCount - a.engineCount ||
    b.totalHits - a.totalHits ||
    a.clusterId.localeCompare(b.clusterId) ||
    a.domain.localeCompare(b.domain)
  )

  return {
    generatedAt: mostRecentAt,
    promptsRun,
    clustersCovered: Array.from(latestPerCluster.keys()),
    perCell,
    crossEngineTargets,
    progrowthAppearances: allAppearances,
  }
}
