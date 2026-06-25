'use client'

import { useEffect, useState } from 'react'

/**
 * Compact logout control mounted in the global layout next to the
 * ClientSwitcher. Renders nothing until /api/auth/check confirms a session,
 * so it never shows on the login screen. Clicking clears the cookie via
 * /api/auth/logout and hard-reloads to '/', which drops back to LoginForm.
 */
export default function LogoutButton() {
  const [authed, setAuthed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/auth/check')
      .then((r) => (r.ok ? r.json() : { authenticated: false }))
      .then((d) => setAuthed(d.authenticated === true))
      .catch(() => setAuthed(false))
  }, [])

  if (!authed) return null

  async function logout() {
    setBusy(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // Even if the request fails, fall through to a reload — the cookie is
      // httpOnly so we can't clear it client-side, but a reload re-checks auth.
    }
    window.location.href = '/'
  }

  return (
    <button
      type="button"
      onClick={logout}
      disabled={busy}
      className="text-xs text-gray-400 border border-gray-700 rounded px-2 py-1 hover:border-gray-500 hover:text-gray-200 focus:outline-none focus:border-lime-400 disabled:opacity-50"
    >
      {busy ? 'Logging out…' : 'Log out'}
    </button>
  )
}
