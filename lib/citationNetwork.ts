/**
 * Per-engine citation network mapping (Task 22).
 *
 * Runs the 25 canonical prompts against ChatGPT + Claude + Perplexity +
 * Gemini, extracts cited domains per (cluster × engine) cell, and ranks
 * the top 15 domains per cell by frequency.
 *
 * Used to drive earned-media outreach targeting (Task 18) and YouTube
 * placement strategy (Task 23). Each engine has materially different
 * source ecosystems — the matrix shows which outlets dominate each one
 * so we know where to invest per-engine effort.
 *
 * Cost per full run: ~$7.25 across all 25 prompts × 4 engines.
 * Designed as a one-shot endpoint (not a cron) — outlet rankings don't
 * change week-over-week. Re-run quarterly or when strategy shifts.
 */

import { CANONICAL_PROMPTS, PROMPT_CLUSTERS, type CanonicalPrompt } from './prompts'

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

export type Engine = 'chatgpt' | 'claude' | 'perplexity' | 'gemini'

export const ALL_ENGINES: Engine[] = ['chatgpt', 'claude', 'perplexity', 'gemini']

const PROGROWTH_DOMAINS = new Set(['progrowth.services', 'www.progrowth.services'])

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
    // ChatGPT / Claude: annotations live under sections[*].annotations[*]
    for (const section of item?.sections ?? []) {
      for (const ann of section?.annotations ?? []) {
        const d = extractDomain(ann.url)
        if (d) domains.add(d)
      }
    }
    // ChatGPT / Claude alt: annotations directly on item
    for (const ann of item?.annotations ?? []) {
      const d = extractDomain(ann.url)
      if (d) domains.add(d)
    }
    // Perplexity: typically `references` array on item OR sections
    for (const ref of item?.references ?? []) {
      const d = extractDomain(ref.url)
      if (d) domains.add(d)
    }
    // Gemini AI Mode: references on item (15 refs per query in our tests)
    if (engine === 'gemini') {
      for (const ref of item?.references ?? []) {
        const d = extractDomain(ref.url)
        if (d) domains.add(d)
      }
      // Also try `links` field which sometimes carries them
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
  hits: number // number of prompts in this cell where this domain was cited
  isProgrowth: boolean
}

export interface PerPromptResult {
  prompt: CanonicalPrompt
  citations: Record<Engine, string[]>
}

export interface CitationNetworkMatrix {
  generatedAt: string
  promptsRun: number
  engines: Engine[]
  /** Top-15 domains per (cluster × engine) cell, by hit count */
  perCell: Record<string /* clusterId */, Record<Engine, DomainRank[]>>
  /** Where ProGrowth appears in any cell, for highlighting wins */
  progrowthAppearances: Array<{
    clusterId: string
    engine: Engine
    promptId: string
    prompt: string
  }>
  /** Top-15 domains across ALL clusters, per engine */
  topByEngine: Record<Engine, DomainRank[]>
  /** Per-prompt raw data for debugging + Supabase storage */
  perPrompt: PerPromptResult[]
}

/**
 * Run all engines against all prompts and aggregate into the matrix.
 * Batches by prompt (each batch fires 4 engines in parallel for that
 * prompt) to keep DataForSEO concurrency reasonable.
 */
export async function computeCitationNetwork(
  prompts: CanonicalPrompt[] = CANONICAL_PROMPTS,
  engines: Engine[] = ALL_ENGINES
): Promise<CitationNetworkMatrix> {
  const perPrompt: PerPromptResult[] = []

  // Sequential by prompt, parallel by engine within each prompt — keeps
  // concurrent API calls at most 4 at a time.
  for (const prompt of prompts) {
    const engineResults = await Promise.all(
      engines.map(async (e) => [e, await fetchEngineCitations(e, prompt.text)] as const)
    )
    const citations = Object.fromEntries(engineResults) as Record<Engine, string[]>
    perPrompt.push({ prompt, citations })
  }

  // Build per-cell counts: cluster → engine → Map<domain, hits>
  const cellMaps: Record<string, Record<Engine, Map<string, number>>> = {}
  for (const cluster of PROMPT_CLUSTERS) {
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

  // Sort + top-15 per cell
  const perCell: Record<string, Record<Engine, DomainRank[]>> = {}
  for (const [clusterId, engineMaps] of Object.entries(cellMaps)) {
    perCell[clusterId] = Object.fromEntries(
      Object.entries(engineMaps).map(([engine, m]) => {
        const ranks = Array.from(m.entries())
          .map(([domain, hits]) => ({
            domain,
            hits,
            isProgrowth: PROGROWTH_DOMAINS.has(domain),
          }))
          .sort((a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain))
          .slice(0, 15)
        return [engine, ranks]
      })
    ) as Record<Engine, DomainRank[]>
  }

  // Top-15 per engine across all clusters
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
          isProgrowth: PROGROWTH_DOMAINS.has(domain),
        }))
        .sort((a, b) => b.hits - a.hits || a.domain.localeCompare(b.domain))
        .slice(0, 15),
    ])
  ) as Record<Engine, DomainRank[]>

  // ProGrowth appearances
  const progrowthAppearances: CitationNetworkMatrix['progrowthAppearances'] = []
  for (const { prompt, citations } of perPrompt) {
    for (const engine of engines) {
      if ((citations[engine] ?? []).some((d) => PROGROWTH_DOMAINS.has(d))) {
        progrowthAppearances.push({
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
    promptsRun: prompts.length,
    engines,
    perCell,
    progrowthAppearances,
    topByEngine,
    perPrompt,
  }
}
