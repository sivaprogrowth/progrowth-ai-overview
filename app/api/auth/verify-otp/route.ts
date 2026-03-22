import { NextRequest, NextResponse } from 'next/server'
import { verifyOTPToken, createSessionToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const { email, code, otpToken } = await req.json()

    if (!email || !code || !otpToken) {
      return NextResponse.json({ error: 'Email, code, and otpToken are required' }, { status: 400 })
    }

    const emailLower = email.toLowerCase().trim()

    if (!verifyOTPToken(otpToken, emailLower, code)) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }

    const token = createSessionToken(emailLower)

    const response = NextResponse.json({ success: true, email: emailLower })
    response.cookies.set('session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // 24 hours
      path: '/',
    })

    return response
  } catch (error: any) {
    console.error('Verify OTP error:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
