import { NextRequest, NextResponse } from 'next/server'
import { generateClientPrompts } from '@/lib/promptGenerator'
import { DataForSeoCapExceededError } from '@/lib/dataforseo'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/clients/generate-prompts
 *
 * Body: { companyName, primaryDomain, description?, verticalsHint?[] }
 * Returns: { clusters, prompts, rejected, cost } — a tailored 5×25 set
 * for the add-client preview. Does NOT persist; the create POST stores it.
 * Auth-gated by middleware (logged-in staff only). ~$0.001/call.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.companyName || !body?.primaryDomain) {
    return NextResponse.json(
      { error: 'companyName and primaryDomain are required' },
      { status: 400 }
    )
  }

  try {
    const result = await generateClientPrompts({
      companyName: String(body.companyName),
      primaryDomain: String(body.primaryDomain),
      description: body.description ? String(body.description) : undefined,
      verticalsHint: Array.isArray(body.verticalsHint)
        ? body.verticalsHint.map(String)
        : undefined,
      competitorSites: Array.isArray(body.competitorSites)
        ? body.competitorSites.map(String)
        : undefined,
      products: Array.isArray(body.products) ? body.products.map(String) : undefined,
      samplePrompts: Array.isArray(body.samplePrompts)
        ? body.samplePrompts.map(String)
        : undefined,
      icpDescription: body.icpDescription ? String(body.icpDescription) : undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof DataForSeoCapExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Generation failed' },
      { status: 502 }
    )
  }
}
