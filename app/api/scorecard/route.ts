import { NextRequest, NextResponse } from 'next/server'
import { fetchKPIScorecard, fetchAiReadinessFromSnapshot } from '@/lib/scorecard'
import { buildRecommendations } from '@/lib/recommendations'
import { getClientFromRequest } from '@/lib/clientContext'
import type { Client } from '@/lib/clients'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Flatten the client's verticals into plain hint strings so the
 *  recommendation engine's local/ecommerce heuristic can fire. */
function verticalHints(client: Client): string[] {
  return client.verticals.flatMap((v) => [v.id, v.name, v.description].filter(Boolean))
}

export async function GET(req: NextRequest) {
  try {
    const client = await getClientFromRequest(req)
    const [cards, readiness] = await Promise.all([
      fetchKPIScorecard(client),
      fetchAiReadinessFromSnapshot(client),
    ])
    const recommendations = buildRecommendations(cards, readiness, {
      verticals: verticalHints(client),
    })
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      client: { id: client.id, slug: client.slug, company_name: client.company_name },
      cards,
      recommendations,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'Failed to fetch scorecard' },
      { status: 500 }
    )
  }
}
