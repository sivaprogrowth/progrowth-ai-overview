import Link from 'next/link'
import KPIScorecard from '@/components/KPIScorecard'
import { fetchKPIScorecard } from '@/lib/scorecard'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ScorecardPage() {
  // Server-side fetch so the page first paint is data-ready. Errors fall back
  // to the client component, which retries via /api/scorecard.
  let initialCards = null
  let generatedAt: string | undefined
  try {
    initialCards = await fetchKPIScorecard()
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
              Weekly KPI snapshot for the AI Referral Lift plan
            </p>
          </div>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
          >
            ← Back to Overview Analysis
          </Link>
        </div>

        <KPIScorecard initialCards={initialCards ?? undefined} generatedAt={generatedAt} />
      </div>
    </div>
  )
}
