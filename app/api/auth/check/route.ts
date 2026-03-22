import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET || 'progrowth-ai-overview-secret-2026'

function verifySessionToken(token: string): { email: string } | null {
  try {
    const [data, sig] = token.split('.')
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(data)
      .digest('base64url')
    if (sig !== expectedSig) return null
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return { email: payload.email }
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const session = req.cookies.get('session')?.value
  if (!session) {
    return NextResponse.json({ authenticated: false })
  }

  const result = verifySessionToken(session)
  if (!result) {
    return NextResponse.json({ authenticated: false })
  }

  return NextResponse.json({ authenticated: true, email: result.email })
}
