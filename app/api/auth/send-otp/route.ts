import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { generateOTP, createOTPToken } from '@/lib/auth'

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  auth: {
    user: process.env.BREVO_SMTP_USER || '',
    pass: process.env.BREVO_SMTP_PASS || '',
  },
})

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const emailLower = email.toLowerCase().trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailLower)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
    }

    const code = generateOTP()
    const otpToken = createOTPToken(emailLower, code)

    await transporter.sendMail({
      from: '"ProGrowth AI Overview" <siva@progrowth.services>',
      to: emailLower,
      subject: `Your login code: ${code}`,
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="color: #84cc16;">ProGrowth AI Overview</h2>
          <p>Your one-time login code is:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 20px; background: #f3f4f6; border-radius: 8px; text-align: center; margin: 20px 0;">
            ${code}
          </div>
          <p style="color: #6b7280; font-size: 14px;">This code expires in 5 minutes.</p>
        </div>
      `,
    })

    const response = NextResponse.json({ success: true })
    response.cookies.set('otp_token', otpToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 5 * 60, // 5 minutes
      path: '/api/auth/',
    })
    return response
  } catch (error: any) {
    console.error('Send OTP error:', error)
    return NextResponse.json({ error: 'Failed to send code', detail: error?.message || String(error) }, { status: 500 })
  }
}
