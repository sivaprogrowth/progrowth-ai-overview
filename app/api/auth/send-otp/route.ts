import { NextRequest, NextResponse } from 'next/server'
import { isBusinessEmail, generateOTP, storeOTP } from '@/lib/auth'

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

    // TODO: Uncomment to restrict to business emails only
    // if (!isBusinessEmail(emailLower)) {
    //   return NextResponse.json(
    //     { error: 'Please use a business email address (no Gmail, Yahoo, etc.)' },
    //     { status: 400 }
    //   )
    // }

    const code = generateOTP()
    storeOTP(emailLower, code)

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY || '',
      },
      body: JSON.stringify({
        sender: { email: 'siva@progrowth.services', name: 'ProGrowth AI Overview' },
        to: [{ email: emailLower }],
        subject: `Your login code: ${code}`,
        htmlContent: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
            <h2 style="color: #84cc16;">ProGrowth AI Overview</h2>
            <p>Your one-time login code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 20px; background: #f3f4f6; border-radius: 8px; text-align: center; margin: 20px 0;">
              ${code}
            </div>
            <p style="color: #6b7280; font-size: 14px;">This code expires in 5 minutes.</p>
          </div>
        `,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('Brevo error:', err)
      return NextResponse.json({ error: 'Failed to send code' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Send OTP error:', error)
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 })
  }
}
