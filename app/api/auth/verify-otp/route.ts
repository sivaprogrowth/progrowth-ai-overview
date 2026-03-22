import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { email, code } = await req.json()

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 })
    }

    const emailLower = email.toLowerCase().trim()

    // Find matching unused, unexpired OTP
    const { data: otpRow, error: fetchError } = await supabase
      .from('otp_codes')
      .select('id')
      .eq('email', emailLower)
      .eq('code', code)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (fetchError || !otpRow) {
      return NextResponse.json({ error: 'Invalid or expired code' }, { status: 401 })
    }

    // Mark OTP as used
    await supabase.from('otp_codes').update({ used: true }).eq('id', otpRow.id)

    // Create session in Supabase
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .insert({
        email: emailLower,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()

    if (sessionError || !session) {
      console.error('Session creation error:', sessionError)
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    const token = createSessionToken(emailLower, session.id)

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
