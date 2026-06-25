import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/logout
 *
 * Clears the `session` cookie so the browser is logged out. The JWT itself
 * isn't server-revocable (middleware only checks its signature + exp), so
 * logout is cookie-clearing — the standard behaviour for this auth model.
 * Allowed without a session (middleware exempts /api/auth/*).
 */
export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set('session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0,
    path: '/',
  })
  return response
}
