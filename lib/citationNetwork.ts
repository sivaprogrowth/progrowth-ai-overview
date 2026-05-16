/**
 * Per-engine citation network mapping (Task 22 / multi-tenant Phase 1).
 *
 * Runs the active prompt set against ChatGPT + Claude + Perplexity +
 * Gemini, extracts cited domains per (cluster × engine) cell, and ranks
 * the top 15 domains per cell by frequency.
 *
 * Used to drive earned-media outreach targeting (Task 18) and YouTube
 * placement strategy (Task 23). Each engine has materially different
 * source ecosystems — the matrix shows which outlets dominate each one
 * so we know where to invest per-engine effort.
 *
 * Multi-tenant note: brand-domain detection is parameterised on the
 * `Client` arg. The function no longer knows about ProGrowth specifically;
 * it flags any domain in `client.alt_domains ∪ {client.primary_domain}`
 * as the client's brand. JSON snapshot field names keep the legacy
 * "progrowth" wording so historical Supabase rows continue to deserialise
 * (see citationNetworkFetcher.ts back-compat read).
 *
 * Cost per full run: ~$7.25 across all 25 prompts × 4 engines.
 * Designed as a one-shot endpoint (not a cron) — outlet rankings don't
 * change week-over-week. Re-run quarterly or when strategy shifts.
 */

import { type Engine, ALL_ENGINES } from './engines'
import { type CanonicalPrompt } from './prompts'
import { getPromptsForClient, getClustersForClient } from './prompts'
import { type Client, getBrandDomainSet } from './clients'

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'

function getAuth(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DataForSEO credentials not configured')
  return Buffer.from(`${login}:${password}`).toString('base64')
}

function extractDomain(input: string | undefined | null): string | null {
  if (!input) return null
  try {
    const url = input.startsWith('http') ? new URL(input) : new URL(`https://${input}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

// Re-export the leaf bindings (imported above for internal use) so existing
// server-side `from '@/lib/citationNetwork'` importers keep working
// unchanged, while client components import from '@/lib/engines' directly
// to avoid bundling lib/supabase into the browser.
export { type Engine, ALL_ENGINES }

// ── Per-engine cited-domain fetchers ──────────────────────────────────────

async function fetchEngineCitations(
  engine: Engine,
  keyword: string
): Promise<string[]> {
  const prompt = `What are the best services or providers for "${keyword}"? List 5-10 companies with their websites and a brief reason for each.`

  const config = {
    chatgpt: {
      path: '/ai_optimization/chat_gpt/llm_responses/live',
      body: { user_prompt: prompt, model_name: 'gpt-4o-mini', web_search: true },
    },
    claude: {
      path: '/ai_optimization/claude/llm_responses/live',
      body: { user_prompt: prompt, model_name: 'claude-sonnet-4-5', web_search: true },
    },
    perplexity: {
      path: '/ai_optimization/perplexity/llm_responses/live',
      body: { user_prompt: prompt, model_name: 'sonar', web_search: true },
    },
    gemini: {
      path: '/serp/google/ai_mode/live/advanced',
      body: { keyword, location_name: 'United States', language_code: 'en' },
    },
  } as const

  const cfg = config[engine]
  try {
    const res = await fetch(`${DATAFORSEO_BASE}${cfg.path}`, {
      method: 'POST',
      headers: { Authorization: `Basic ${getAuth()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([cfg.body]),
    })
    if (!res.ok) return []
    const data = (await res.json()) as any
    return parseCitations(engine, data)
  } catch {
    return []
  }
}

function parseCitations(engine: Engine, data: any): string[] {
  const items = data?.tasks?.[0]?.result?.[0]?.items ?? []
  const domains = new Set<string>()

  for (const item of items) {
    for (const section of item?.sections ?? []) {
      for (const ann of section?.annotations ?? []) {
        const d = extractDomain(ann.url)
        if (d) domains.add(d)
      }
    }
    for (const ann of item?.annotations ?? []) {
      const d = extractDomain(ann.url)
      if (d) domains.add(d)
    }
    for (const ref of item?.references ?? []) {
      const d = extractDomain(ref.url)
      if (d) domains.add(d)
    }
    if (engine === 'gemini') {
      for (const ref of item?.references ?? []) {
        const d = extractDomain(ref.url)
        if (d) domains.add(d)
      }
      for (const link of item?.links ?? []) {
        const d = extractDomain(link.url)
        if (d) domains.add(d)
      }
    }
  }

  return Array.from(domains)
}

// ── Matrix computation ────────────────────────────────────────────────────

export interface DomainRank {
  domain: string
  hits: number
  /** True if this domain is in the client's brand domain set. Field kept as
   *  `isClientBrand` going forward; legacy `isProgrowth` is read by the
   *  fetcher's back-compat layer. */
  isClientBrand: boolean
}

export interface PerPromptResult {
  prompt: CanonicalPrompt
  citations: Record<Engine, string[]>
}

export interface BrandAppearance {
  clusterId: string
  engine: Engine
  promptId: string
  prompt: string
}

export interface CitationNetworkMatrix {
  generatedAt: string
  promptsRun: number
  engines: Engine[]
  perCell: Record<string /* clusterId */, Record<Engine, DomainRank[]>>
  brandAppearances: BrandAppearance[]
  topByEngine: Record<Engine, DomainRank[]>
  perPrompt: PerPromptResult[]
}

/**
 * Run all engines against the client's active prompt set and aggregate
 * into the matrix. Batches prompts 5-at-a-time (each firing 4 engine
 * calls in parallel) — 25 prompts complete in ~15s, well under the 60s
 * Vercel Hobby function timeout.
 */
export async function computeCitationNetwork(
  client: Client,
  prompts?: CanonicalPrompt[],
  engines: Engine[] = ALL_ENGINES
): Promise<CitationNetworkMatrix> {
  const promptSet = prompts ?? getPromptsForClient(client)
  const clusters = getClustersForClient(client)
  const brandDomains = getBrandDomainSet(client)

  const perPrompt: PerPromptResult[] = []
  const PROMPT_BATCH = 5

  for (let i = 0; i < promptSet.length; i += PROMPT_BATCH) {
    const slice = promptSet.slice(i, i + PROMPT_BATCH)
    const batchResults = await Promise.all(
      slice.map(async (prompt) => {
        const engineResults = await Promise.all(
          engines.map(async (e) => [e, await fetchEngineCitations(e, prompt.text)] as const)
        )
        const citations = Object.fromEntries(engineResults) as Record<Engine, string[]>
        return { prompt, citations }
      })
    )
    perPrompt.push(...batchResults)
  }

  // Build per-cell counts: cluster → engine → Map<domain, hits>
  const cellMaps: Record<string, Record<Engine, Map<string, number>>> = {}
  for (const cluster of clusters) {
    cellMaps[cluster.id] = Object.fromEntries(
      engines.map((e) => [e, new Map<string, number>()])
    ) as Record<Engine, Map<string, number>>
  }

  for (const { prompt, citations } of perPrompt) {
    for (const engine of engines) {
      const m = cellMaps[prompt.cluster]?.[engine]
      if (!m) continue
      for (const domain of citations[engine] ?? []) {
        m.set(domain, (m.get(domain) ?? 0) + 1)
      }
    }
  }

  const perCell: Record<string, Record<Engine, DomainRank[]>> = {}
  for (const [clusterId, engineMaps] of Object.entries(cellMaps)) {
    perCell[clusterId] = Object.fromEntries(
      Object.entries(engineMaps).map(([engine, m]) => {
        const ranks = Array.from(m.entries())
          .map(([domain, hits]) => ({
            domain,
            hits,
            isClientBrand: brandDomains.has(domain),
          }))
          .sort((a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain))
          .slice(0, 15)
        return [engine, ranks]
      })
    ) as Record<Engine, DomainRank[]>
  }

  const engineTotals: Record<Engine, Map<string, number>> = Object.fromEntries(
    engines.map((e) => [e, new Map<string, number>()])
  ) as Record<Engine, Map<string, number>>

  for (const { citations } of perPrompt) {
    for (const engine of engines) {
      for (const domain of citations[engine] ?? []) {
        const m = engineTotals[engine]
        m.set(domain, (m.get(domain) ?? 0) + 1)
      }
    }
  }

  const topByEngine: Record<Engine, DomainRank[]> = Object.fromEntries(
    Object.entries(engineTotals).map(([engine, m]) => [
      engine,
      Array.from(m.entries())
        .map(([domain, hits]) => ({
          domain,
          hits,
          isClientBrand: brandDomains.has(domain),
        }))
        .sort((a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain))
        .slice(0, 15),
    ])
  ) as Record<Engine, DomainRank[]>

  const brandAppearances: BrandAppearance[] = []
  for (const { prompt, citations } of perPrompt) {
    for (const engine of engines) {
      if ((citations[engine] ?? []).some((d) => brandDomains.has(d))) {
        brandAppearances.push({
          clusterId: prompt.cluster,
          engine,
          promptId: prompt.id,
          prompt: prompt.text,
        })
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    promptsRun: promptSet.length,
    engines,
    perCell,
    brandAppearances,
    topByEngine,
    perPrompt,
  }
}
