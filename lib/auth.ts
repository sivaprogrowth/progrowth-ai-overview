import crypto from 'crypto'

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'live.com', 'msn.com', 'me.com', 'inbox.com',
])

const JWT_SECRET = process.env.JWT_SECRET || 'progrowth-ai-overview-secret-2026'

export function isBusinessEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return !FREE_EMAIL_DOMAINS.has(domain)
}

export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString()
}

// Create a signed token containing the OTP code + email + expiry
// This allows stateless verification (no in-memory store needed for serverless)
export function createOTPToken(email: string, code: string): string {
  const payload = {
    email: email.toLowerCase(),
    code,
    exp: Date.now() + 5 * 60 * 1000, // 5 minutes
  }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64url')
  return `${data}.${sig}`
}

export function verifyOTPToken(token: string, email: string, code: string): boolean {
  try {
    const [data, sig] = token.split('.')
    const expectedSig = crypto
      .createHmac('sha256', JWT_SECRET)
      .update(data)
      .digest('base64url')
    if (sig !== expectedSig) return false
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    if (Date.now() > payload.exp) return false
    if (payload.email !== email.toLowerCase()) return false
    if (payload.code !== code) return false
    return true
  } catch {
    return false
  }
}

// ── Session tokens ──
export function createSessionToken(email: string): string {
  const payload = {
    email,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64url')
  return `${data}.${sig}`
}
