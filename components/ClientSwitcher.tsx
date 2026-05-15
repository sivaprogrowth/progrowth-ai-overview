'use client'

import { useEffect, useState } from 'react'

interface ClientOption {
  id: string
  slug: string
  company_name: string
  primary_domain: string
}

const CLIENT_COOKIE = 'client_slug'

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
  return match ? decodeURIComponent(match[1]) : null
}

function setCookie(name: string, value: string): void {
  // 30-day cookie. Path=/ so every route sees it.
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

/**
 * Compact client switcher mounted in the global layout. Reads the available
 * clients from /api/clients and writes the selected slug to a cookie that
 * server components read via lib/clientContext.
 *
 * Hidden when only one client exists (the agency hasn't added any tenants
 * besides the seeded ProGrowth row yet) — the dropdown would be busywork.
 */
export default function ClientSwitcher() {
  const [clients, setClients] = useState<ClientOption[] | null>(null)
  const [selected, setSelected] = useState<string>('progrowth')

  useEffect(() => {
    fetch('/api/clients')
      .then((r) => (r.ok ? r.json() : { clients: [] }))
      .then((d) => setClients(d.clients ?? []))
      .catch(() => setClients([]))
    setSelected(getCookie(CLIENT_COOKIE) ?? 'progrowth')
  }, [])

  if (!clients || clients.length <= 1) return null

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500 uppercase tracking-wide">Client</span>
      <select
        value={selected}
        onChange={(e) => {
          const slug = e.target.value
          setSelected(slug)
          setCookie(CLIENT_COOKIE, slug)
          // Full reload so server components re-render with the new client
          window.location.reload()
        }}
        className="bg-gray-900 border border-gray-700 text-gray-200 rounded px-2 py-1 hover:border-gray-500 focus:outline-none focus:border-lime-400"
      >
        {clients.map((c) => (
          <option key={c.slug} value={c.slug}>
            {c.company_name}
          </option>
        ))}
      </select>
    </div>
  )
}
