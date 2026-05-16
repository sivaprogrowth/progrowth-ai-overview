/**
 * Multi-tenant client registry (Phase 1 of multi-tenant migration).
 *
 * Each row in the `clients` table represents one tenant the agency analyses
 * with this tool. The ProGrowth row is seeded by migration 001 and remains
 * the default fallback whenever no client is selected.
 *
 * Schema lives in `migrations/001_multi_tenant_clients.sql`. Keep this
 * Client type in sync with the columns there.
 */

import { unstable_cache } from 'next/cache'
import { supabase } from './supabase'
import type { CanonicalPrompt, PromptCluster, PromptType } from './prompts'

export interface KpiBaseline {
  baseline: number
  /** Number for numeric KPIs (1, 2), or display string for narrative KPIs (4, 5) */
  target30d: number | string
  target90d: number | string
}

export type KpiBaselineSet = Partial<Record<'1' | '2' | '3' | '4' | '5', KpiBaseline>>

export interface Client {
  id: string
  slug: string
  company_name: string
  primary_domain: string
  alt_domains: string[]
  brand_name_patterns: string[]
  /** Configured competitor domains — prioritised in transform competitor
   *  slots, highlighted in citation-network, fed to the prompt generator.
   *  Empty = competitors are purely auto-derived (any non-brand domain). */
  competitor_sites: string[]
  brand_description: string
  /** Empty array = fall back to the default PROMPT_CLUSTERS in lib/prompts */
  verticals: PromptCluster[]
  /** Empty array = fall back to the default CANONICAL_PROMPTS in lib/prompts */
  prompts: CanonicalPrompt[]
  /** Empty array = derive 5 from prompts at KPI 5 weekly probe time */
  probe_queries: string[]
  matomo_site_id: string | null
  matomo_url: string | null
  kpi_baselines: KpiBaselineSet
  is_active: boolean
  cron_enabled: boolean
  notification_email: string | null
  created_at: string
  updated_at: string
}

/** Cache TTL for in-process memoisation. 5 min balances "config edits land
 *  quickly" vs "don't pound Supabase on every API request". */
const CACHE_TTL_SECONDS = 300

const SELECT_COLUMNS = `
  id, slug, company_name, primary_domain, alt_domains,
  brand_name_patterns, competitor_sites, brand_description, verticals, prompts,
  probe_queries, matomo_site_id, matomo_url, kpi_baselines,
  is_active, cron_enabled, notification_email,
  created_at, updated_at
`

function ensureType<T>(value: unknown, fallback: T): T {
  return (value === null || value === undefined) ? fallback : (value as T)
}

function normaliseRow(row: any): Client {
  return {
    id: row.id,
    slug: row.slug,
    company_name: row.company_name,
    primary_domain: row.primary_domain,
    alt_domains: ensureType<string[]>(row.alt_domains, []),
    brand_name_patterns: ensureType<string[]>(row.brand_name_patterns, []),
    competitor_sites: ensureType<string[]>(row.competitor_sites, []),
    brand_description: row.brand_description ?? '',
    verticals: ensureType<PromptCluster[]>(row.verticals, []),
    prompts: ensureType<CanonicalPrompt[]>(row.prompts, []),
    probe_queries: ensureType<string[]>(row.probe_queries, []),
    matomo_site_id: row.matomo_site_id ?? null,
    matomo_url: row.matomo_url ?? null,
    kpi_baselines: ensureType<KpiBaselineSet>(row.kpi_baselines, {}),
    is_active: row.is_active !== false,
    cron_enabled: !!row.cron_enabled,
    notification_email: row.notification_email ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

async function fetchClientBySlug(slug: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select(SELECT_COLUMNS)
    .eq('slug', slug)
    .maybeSingle()
  if (error || !data) return null
  return normaliseRow(data)
}

async function fetchClientById(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return null
  return normaliseRow(data)
}

async function fetchActiveClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(SELECT_COLUMNS)
    .eq('is_active', true)
    .order('slug', { ascending: true })
  if (error || !data) return []
  return data.map(normaliseRow)
}

export const getClientBySlug = unstable_cache(
  fetchClientBySlug,
  ['client-by-slug'],
  { revalidate: CACHE_TTL_SECONDS, tags: ['clients'] }
)

export const getClientById = unstable_cache(
  fetchClientById,
  ['client-by-id'],
  { revalidate: CACHE_TTL_SECONDS, tags: ['clients'] }
)

/**
 * Always fresh — deliberately NOT unstable_cache'd.
 *
 * A cached empty list is a correctness hazard, not a perf win: it once
 * pinned `[]` (cached before the migration seed, never invalidated since
 * `revalidateTag('clients')` only fires on client creation) so /clients
 * showed a false "did the migration run?" and the cron fan-out would have
 * dispatched to zero clients. The table is tiny and this is called only by
 * the (force-dynamic) /clients page, /api/clients, and the cron fan-out —
 * a direct query each time is cheap and safe. The per-key getClientBySlug/
 * getClientById stay cached (hot per-request, self-populating correctly).
 */
export const listActiveClients = fetchActiveClients

export const DEFAULT_CLIENT_SLUG = 'progrowth'

/** Returns the ProGrowth client row — the safe fallback for any code path
 *  that hasn't been threaded with a client context yet. Throws if the seed
 *  migration hasn't been applied. */
export async function getDefaultClient(): Promise<Client> {
  const client = await getClientBySlug(DEFAULT_CLIENT_SLUG)
  if (!client) {
    throw new Error(
      `Default client '${DEFAULT_CLIENT_SLUG}' is missing from the clients table. Did migration 001_multi_tenant_clients.sql run?`
    )
  }
  return client
}

// ── Brand-match helpers ───────────────────────────────────────────────────

/**
 * Build the full set of regex patterns used to detect brand mentions in
 * AI response bodies. Combines:
 *   1. User-provided patterns (from clients.brand_name_patterns)
 *   2. Auto-derived patterns from the primary domain stem (e.g. "acmecorp")
 *   3. Auto-derived patterns from the company name with optional whitespace
 *
 * Returns compiled RegExp objects. Falls back gracefully on invalid user
 * regex (skips with a console warning rather than throwing).
 */
export function buildBrandMatchPatterns(client: Client): RegExp[] {
  const patterns: RegExp[] = []

  for (const raw of client.brand_name_patterns) {
    try {
      patterns.push(new RegExp(raw, 'gi'))
    } catch (e) {
      console.warn(`[clients] Invalid regex in brand_name_patterns for ${client.slug}: ${raw}`, e)
    }
  }

  // Auto: domain stem (e.g. acmecorp.com → "acmecorp")
  const stem = client.primary_domain.replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/i, '').replace(/^www\./, '')
  if (stem && stem.length >= 3) {
    patterns.push(new RegExp(`\\b${escapeRegex(stem)}\\b`, 'gi'))
  }

  // Auto: company name with optional whitespace between tokens
  if (client.company_name) {
    const tokens = client.company_name
      .replace(/(LLC|Inc\.?|Ltd\.?|Corp\.?|GmbH|Co\.?|Services|Group)$/i, '')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2)
    if (tokens.length > 0) {
      const joined = tokens.map(escapeRegex).join('\\s*')
      patterns.push(new RegExp(`\\b${joined}\\b`, 'gi'))
    }
  }

  return patterns
}

/**
 * Build the set of domains (including alt domains) that flag a citation
 * as belonging to this client.
 */
export function getBrandDomainSet(client: Client): Set<string> {
  const set = new Set<string>()
  set.add(client.primary_domain.toLowerCase())
  for (const d of client.alt_domains) set.add(d.toLowerCase())
  // Also auto-add www. variant if not already present
  if (!set.has(`www.${client.primary_domain}`)) set.add(`www.${client.primary_domain.toLowerCase()}`)
  return set
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
