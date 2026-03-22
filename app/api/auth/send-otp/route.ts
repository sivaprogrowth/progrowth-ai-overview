import { NextRequest, NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import { generateOTP } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

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

    // Store OTP in Supabase
    const { error: dbError } = await supabase.from('otp_codes').insert({
      email: emailLower,
      code,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    })

    if (dbError) {
      console.error('Supabase insert error:', dbError)
      return NextResponse.json({ error: 'Failed to generate code' }, { status: 500 })
    }

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

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Send OTP error:', error)
    return NextResponse.json({ error: 'Failed to send code', detail: error?.message || String(error) }, { status: 500 })
  }
}
