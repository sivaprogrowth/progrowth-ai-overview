import Link from 'next/link'
import { cookies } from 'next/headers'
import { listActiveClients } from '@/lib/clients'
import { getClientFromCookies } from '@/lib/clientContext'
import ClientSelectButton from '@/components/ClientSelectButton'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function ClientsPage() {
  const cookieJar = await cookies()
  const [clients, current] = await Promise.all([
    listActiveClients(),
    getClientFromCookies(cookieJar),
  ])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              <span className="text-lime-400">ProGrowth</span> Clients
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              {clients.length} active {clients.length === 1 ? 'tenant' : 'tenants'} ·
              selecting one scopes the scorecard, citation network &amp; crawls to it
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <Link
              href="/clients/new"
              className="text-lime-400 hover:text-lime-300 underline-offset-2 hover:underline font-medium"
            >
              + New client
            </Link>
            <Link
              href="/scorecard"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              GEO Scorecard
            </Link>
            <Link
              href="/citation-network"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              Citation Network
            </Link>
            <Link
              href="/"
              className="text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline"
            >
              ← Overview Analysis
            </Link>
          </div>
        </div>

        {clients.length === 0 ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-6 text-gray-400 text-sm">
            No active clients found. Did the multi-tenant migration
            (<code className="text-gray-300">001_multi_tenant_clients.sql</code>) run?
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map((c) => {
              const isActive = c.id === current.id
              return (
                <div
                  key={c.id}
                  className={`rounded-xl border p-5 flex flex-wrap items-center justify-between gap-4 ${
                    isActive
                      ? 'border-lime-700/50 bg-lime-500/5'
                      : 'border-gray-800 bg-gray-900/60'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold text-white">
                        {c.company_name}
                      </span>
                      <span className="text-xs text-gray-500">/{c.slug}</span>
                    </div>
                    <div className="text-sm text-gray-400">{c.primary_domain}</div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded ${
                          c.cron_enabled
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-gray-700/40 text-gray-400'
                        }`}
                      >
                        {c.cron_enabled ? 'cron enabled' : 'cron off'}
                      </span>
                      <span
                        className={`text-[11px] px-2 py-0.5 rounded ${
                          c.matomo_site_id
                            ? 'bg-sky-500/15 text-sky-300'
                            : 'bg-gray-700/40 text-gray-400'
                        }`}
                      >
                        {c.matomo_site_id ? `matomo #${c.matomo_site_id}` : 'no matomo'}
                      </span>
                    </div>
                  </div>
                  <ClientSelectButton slug={c.slug} active={isActive} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
