import { NextRequest, NextResponse } from 'next/server'
import { fetchKPIScorecard } from '@/lib/scorecard'
import { getClientFromRequest } from '@/lib/clientContext'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  try {
    const client = await getClientFromRequest(req)
    const cards = await fetchKPIScorecard(client)
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      client: { id: client.id, slug: client.slug, company_name: client.company_name },
      cards,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'Failed to fetch scorecard' },
      { status: 500 }
    )
  }
}
