import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET || 'progrowth-ai-overview-secret-2026'

function verifyToken(token: string): boolean {
  try {
    const [data, sig] = token.split('.')
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(data)
      .digest('base64url')
    if (sig !== expectedSig) return false
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    return payload.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Allow auth API routes without session
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next()
  }

  // Check session cookie
  const session = req.cookies.get('session')?.value
  if (session && verifyToken(session)) {
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
