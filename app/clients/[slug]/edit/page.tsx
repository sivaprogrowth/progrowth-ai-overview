import Link from 'next/link'
import { notFound } from 'next/navigation'
import EditClientForm from '@/components/EditClientForm'
import { getClientFromSlug } from '@/lib/clientContext'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const client = await getClientFromSlug(slug)
  if (!client) notFound()

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              Edit <span className="text-lime-400">{client.company_name}</span>
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              ICP / target verticals · {client.primary_domain}{' '}
              <span className="text-gray-600">·</span> /{client.slug}
            </p>
          </div>
          <Link
            href="/clients"
            className="text-sm text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline whitespace-nowrap"
          >
            ← All clients
          </Link>
        </div>

        <EditClientForm
          slug={client.slug}
          companyName={client.company_name}
          primaryDomain={client.primary_domain}
          brandDescription={client.brand_description}
          probeQueries={client.probe_queries}
          competitorSites={client.competitor_sites}
          verticalsCount={client.verticals.length}
          promptsCount={client.prompts.length}
        />
      </div>
    </div>
  )
}
