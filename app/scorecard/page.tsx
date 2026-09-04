import Link from 'next/link'
import { cookies } from 'next/headers'
import KPIScorecard from '@/components/KPIScorecard'
import { fetchKPIScorecard, fetchAiReadinessFromSnapshot } from '@/lib/scorecard'
import { buildRecommendations, type Recommendation } from '@/lib/recommendations'
import { getClientFromCookies } from '@/lib/clientContext'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ScorecardPage() {
  const cookieJar = await cookies()
  const client = await getClientFromCookies(cookieJar)

  let initialCards = null
  let initialRecommendations: Recommendation[] | undefined
  let generatedAt: string | undefined
  try {
    const [cards, readiness] = await Promise.all([
      fetchKPIScorecard(client),
      fetchAiReadinessFromSnapshot(client),
    ])
    initialCards = cards
    initialRecommendations = buildRecommendations(cards, readiness, {
      verticals: client.verticals.flatMap((v) => [v.id, v.name, v.description].filter(Boolean)),
    })
    generatedAt = new Date().toISOString()
  } catch {
    initialCards = null
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              <span className="text-lime-400">ProGrowth</span> GEO Scorecard
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Weekly KPI snapshot for <span className="text-white">{client.company_name}</span> · {client.primary_domain}
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <Link
              href="/clients"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              Clients
            </Link>
            <Link
              href="/citation-network"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              Citation Network
            </Link>
            <Link
              href="/dashboard"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              ← Back to Overview Analysis
            </Link>
          </div>
        </div>

        <KPIScorecard
          initialCards={initialCards ?? undefined}
          initialRecommendations={initialRecommendations}
          generatedAt={generatedAt}
        />
      </div>
    </div>
  )
}
