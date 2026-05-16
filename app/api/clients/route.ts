import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { listActiveClients } from '@/lib/clients'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Split a textarea/comma list into a clean string[]. */
function toList(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function cleanDomain(v: string): string {
  return v.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
}

/**
 * GET /api/clients
 *
 * Returns the active clients available in the dropdown switcher. Sensitive
 * fields (kpi_baselines internals etc.) are passed through as-is for now —
 * this endpoint is auth-gated by middleware so only logged-in agency staff
 * can hit it. Phase 3 will add a slimmer DTO when the public per-client
 * pages start serving client stakeholders directly.
 */
export async function GET() {
  const clients = await listActiveClients()
  return NextResponse.json({
    clients: clients.map((c) => ({
      id: c.id,
      slug: c.slug,
      company_name: c.company_name,
      primary_domain: c.primary_domain,
      cron_enabled: c.cron_enabled,
    })),
  })
}

/**
 * POST /api/clients — create a new tenant (Phase 3 add-client UX).
 *
 * Only the human-entered identity/config fields. verticals / prompts /
 * probe_queries / kpi_baselines are intentionally left empty: lib/clients.ts
 * and lib/scorecard.ts fall back to CANONICAL_PROMPTS / DEFAULT_BASELINES,
 * so a freshly-added client works immediately. cron_enabled defaults false
 * for cost safety (opt-in). Auth-gated by middleware (logged-in staff only).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const company_name = String(body.company_name ?? '').trim()
  const primary_domain = cleanDomain(String(body.primary_domain ?? ''))
  const slug = String(body.slug ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  if (!company_name) {
    return NextResponse.json({ error: 'company_name is required' }, { status: 400 })
  }
  if (!primary_domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(primary_domain)) {
    return NextResponse.json({ error: 'A valid primary_domain is required (e.g. acme.com)' }, { status: 400 })
  }
  if (!slug || slug.length < 2) {
    return NextResponse.json({ error: 'A valid slug is required (a-z, 0-9, hyphens)' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('clients')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (existing) {
    return NextResponse.json({ error: `Slug "${slug}" is already taken` }, { status: 409 })
  }

  const row = {
    slug,
    company_name,
    primary_domain,
    alt_domains: toList(body.alt_domains),
    brand_name_patterns: toList(body.brand_name_patterns),
    brand_description: String(body.brand_description ?? '').trim(),
    // AI-generated set from /api/clients/generate-prompts when present;
    // otherwise empty → lib/clients falls back to CANONICAL_PROMPTS.
    verticals: Array.isArray(body.verticals) ? body.verticals : [],
    prompts: Array.isArray(body.prompts) ? body.prompts : [],
    probe_queries: [],
    matomo_site_id: body.matomo_site_id ? String(body.matomo_site_id).trim() : null,
    matomo_url: body.matomo_url ? String(body.matomo_url).trim().replace(/\/+$/, '') : null,
    kpi_baselines: {},
    is_active: true,
    cron_enabled: body.cron_enabled === true,
    notification_email: body.notification_email ? String(body.notification_email).trim() : null,
  }

  const { data, error } = await supabase
    .from('clients')
    .insert(row)
    .select('id, slug, company_name, primary_domain')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to create client' },
      { status: 500 }
    )
  }

  // Bust the unstable_cache('clients') tag so the new tenant appears
  // immediately in listActiveClients / getClientBySlug.
  revalidateTag('clients')

  return NextResponse.json({ client: data }, { status: 201 })
}
