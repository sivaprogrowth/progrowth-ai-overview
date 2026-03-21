import { NextRequest, NextResponse } from 'next/server'

export function middleware(req: NextRequest) {
  const auth = req.headers.get('authorization')

  if (auth) {
    const [scheme, encoded] = auth.split(' ')
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded)
      const [user, pass] = decoded.split(':')
      if (
        user === process.env.BASIC_AUTH_USER &&
        pass === process.env.BASIC_AUTH_PASSWORD
      ) {
        return NextResponse.next()
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="ProGrowth AI Overview"' },
  })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
