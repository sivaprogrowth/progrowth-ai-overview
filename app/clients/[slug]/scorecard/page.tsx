import Link from 'next/link'
import { notFound } from 'next/navigation'
import KPIScorecard from '@/components/KPIScorecard'
import { fetchKPIScorecard, fetchAiReadinessFromSnapshot } from '@/lib/scorecard'
import { buildRecommendations, type Recommendation } from '@/lib/recommendations'
import { getClientFromSlug } from '@/lib/clientContext'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClientScorecardPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const client = await getClientFromSlug(slug)
  if (!client) notFound()

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
              <span className="text-lime-400">{client.company_name}</span> GEO Scorecard
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Per-client snapshot · {client.primary_domain}{' '}
              <span className="text-gray-600">·</span> /{client.slug}
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <Link
              href="/clients"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              ← All clients
            </Link>
            <Link
              href="/citation-network"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              Citation Network
            </Link>
          </div>
        </div>

        <KPIScorecard
          initialCards={initialCards ?? undefined}
          initialRecommendations={initialRecommendations}
          generatedAt={generatedAt}
          clientSlug={client.slug}
        />
      </div>
    </div>
  )
}
