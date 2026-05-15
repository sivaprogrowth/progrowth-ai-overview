import { NextResponse } from 'next/server'
import { listActiveClients } from '@/lib/clients'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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
