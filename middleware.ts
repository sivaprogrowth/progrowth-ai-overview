import { NextRequest, NextResponse } from 'next/server'

const JWT_SECRET = process.env.JWT_SECRET || 'progrowth-ai-overview-secret-2026'

async function verifyToken(token: string): Promise<boolean> {
  try {
    const [data, sig] = token.split('.')
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
    const expectedSig = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    if (sig !== expectedSig) return false
    const payload = JSON.parse(atob(data.replace(/-/g, '+').replace(/_/g, '/')))
    return payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow auth API routes without session
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // ProGrowth AI Grader — a separate, intentionally PUBLIC product surface.
  // ONLY these two exact routes are exposed with no auth. This is a narrow
  // allowlist, not a `/api/grader/` prefix match, so any future internal
  // grader route (an admin view, a cost dashboard, …) stays behind the
  // session/Bearer checks below by default.
  if (pathname === '/api/grader/analyze' || pathname.startsWith('/api/grader/report/')) {
    return NextResponse.next()
  }

  // Allow batch/matomo/cron routes with Bearer token
  if (
    pathname.startsWith('/api/analyze/batch') ||
    pathname.startsWith('/api/matomo/') ||
    pathname.startsWith('/api/cron/')
  ) {
    const authHeader = req.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      if (
        token === process.env.BATCH_API_KEY ||
        token === process.env.CRON_SECRET
      ) {
        return NextResponse.next()
      }
    }
  }

  // Check session cookie
  const session = req.cookies.get('session')?.value
  if (session && await verifyToken(session)) {
    return NextResponse.next()
  }

  // For API routes, return 401
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // For page routes, let the client-side handle showing login
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
