'use client'

import { useState } from 'react'

const CLIENT_COOKIE = 'client_slug'

function setCookie(name: string, value: string): void {
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

/**
 * Sets the `client_slug` cookie (same mechanism as ClientSwitcher) so every
 * server component resolves to this tenant, then navigates to the scorecard.
 * Used by the /clients list. `active` renders the current selection as a
 * non-actionable badge.
 */
export default function ClientSelectButton({
  slug,
  active,
}: {
  slug: string
  active: boolean
}) {
  const [busy, setBusy] = useState(false)

  if (active) {
    return (
      <span className="text-xs px-3 py-1.5 rounded-md border border-lime-700/50 bg-lime-500/10 text-lime-300">
        Active
      </span>
    )
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true)
        setCookie(CLIENT_COOKIE, slug)
        // Full navigation so every server component re-resolves the client.
        window.location.href = '/scorecard'
      }}
      className="text-xs px-3 py-1.5 rounded-md border border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-gray-500 text-gray-300 disabled:opacity-50"
    >
      {busy ? 'Switching…' : 'Use this client'}
    </button>
  )
}
