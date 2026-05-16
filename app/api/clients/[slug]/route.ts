import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getClientBySlug } from '@/lib/clients'
import { toList, toDomainList, toIcpProfile } from '@/lib/clientInput'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * PATCH /api/clients/[slug]
 *
 * Partial update of a client's ICP. ONLY these fields are editable here —
 * everything else (slug/domain/matomo/cron/baselines) is intentionally
 * immutable through this endpoint:
 *   verticals, prompts, brand_description, probe_queries, competitor_sites
 *
 * Omitting a field leaves it unchanged. `updated_at` is bumped by the
 * clients_touch_updated_at_trg trigger. Auth-gated by middleware
 * (logged-in staff only — /api/clients is not in the Bearer allowlist).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const client = await getClientBySlug(slug)
  if (!client) {
    return NextResponse.json({ error: `Client "${slug}" not found` }, { status: 404 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Build a partial patch — only keys actually present in the body are
  // touched, so a field left out is preserved.
  const patch: Record<string, unknown> = {}

  if ('verticals' in body) {
    if (!Array.isArray(body.verticals)) {
      return NextResponse.json({ error: 'verticals must be an array' }, { status: 400 })
    }
    patch.verticals = body.verticals
  }
  if ('prompts' in body) {
    if (!Array.isArray(body.prompts)) {
      return NextResponse.json({ error: 'prompts must be an array' }, { status: 400 })
    }
    patch.prompts = body.prompts
  }
  if ('brand_description' in body) {
    patch.brand_description = String(body.brand_description ?? '').trim()
  }
  if ('probe_queries' in body) {
    patch.probe_queries = toList(body.probe_queries)
  }
  if ('competitor_sites' in body) {
    patch.competitor_sites = toDomainList(body.competitor_sites)
  }
  if ('icp_profile' in body) {
    patch.icp_profile = toIcpProfile(body.icp_profile)
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'No editable fields provided (verticals, prompts, brand_description, probe_queries, competitor_sites, icp_profile)' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('slug', slug)
    .select('id, slug, company_name, primary_domain, competitor_sites, updated_at')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to update client' },
      { status: 500 }
    )
  }

  // Bust the unstable_cache('clients') tag so getClientBySlug/getClientById
  // re-read the new ICP immediately.
  revalidateTag('clients')

  return NextResponse.json({ client: data, updated: Object.keys(patch) })
}
