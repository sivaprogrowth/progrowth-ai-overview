'use client'

import { usePathname } from 'next/navigation'
import ClientSwitcher from './ClientSwitcher'
import LogoutButton from './LogoutButton'

/**
 * Wraps the internal-dashboard chrome (client switcher + logout button)
 * mounted globally in app/layout.tsx. Hidden on every /grader/* route —
 * the public AI Grader is a separate, unauthenticated product surface and
 * must never show internal tenant-switching or session controls, even
 * though both components already no-op without a session (see their own
 * null-render guards). This also skips the two internal-API fetches
 * (/api/clients, /api/auth/check) those components make on mount, which
 * public grader visitors have no reason to trigger.
 */
export default function InternalChrome() {
  const pathname = usePathname()
  if (pathname?.startsWith('/grader')) return null

  return (
    <div className="fixed top-3 right-4 z-50 flex items-center gap-2">
      <ClientSwitcher />
      <LogoutButton />
    </div>
  )
}
