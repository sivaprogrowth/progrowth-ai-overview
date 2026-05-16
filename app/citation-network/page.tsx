import Link from 'next/link'
import { cookies } from 'next/headers'
import CitationNetworkView from '@/components/CitationNetworkView'
import { fetchCitationNetworkSnapshot } from '@/lib/citationNetworkFetcher'
import { getClientFromCookies } from '@/lib/clientContext'
import { getClustersForClient } from '@/lib/prompts'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function CitationNetworkPage() {
  const cookieJar = await cookies()
  const client = await getClientFromCookies(cookieJar)

  let snapshot = null
  try {
    snapshot = await fetchCitationNetworkSnapshot(client)
  } catch {
    snapshot = null
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              <span className="text-lime-400">Citation</span> Network
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Per-engine cited domains for <span className="text-white">{client.company_name}</span>. Drives
              earned-media outreach (Task 18) and YouTube placement (Task 23).
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
              href="/scorecard"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              GEO Scorecard
            </Link>
            <Link
              href="/"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              ← Back to Overview Analysis
            </Link>
          </div>
        </div>

        <CitationNetworkView
          snapshot={snapshot}
          client={{ slug: client.slug, company_name: client.company_name }}
          clusters={getClustersForClient(client).map((c) => ({ id: c.id, name: c.name }))}
          competitorSites={client.competitor_sites}
        />
      </div>
    </div>
  )
}
