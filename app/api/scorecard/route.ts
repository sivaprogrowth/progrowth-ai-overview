import { NextResponse } from 'next/server'
import { fetchKPIScorecard } from '@/lib/scorecard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const cards = await fetchKPIScorecard()
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      cards,
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? 'Failed to fetch scorecard' },
      { status: 500 }
    )
  }
}
