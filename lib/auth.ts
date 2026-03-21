import crypto from 'crypto'

// ── OTP Store (in-memory, fine for internal tool) ──
const otpStore = new Map<string, { code: string; expires: number }>()

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'mail.com', 'protonmail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'live.com', 'msn.com', 'me.com', 'inbox.com',
])

export function isBusinessEmail(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  return !FREE_EMAIL_DOMAINS.has(domain)
}

export function generateOTP(): string {
  return crypto.randomInt(100000, 999999).toString()
}

export function storeOTP(email: string, code: string) {
  otpStore.set(email.toLowerCase(), {
    code,
    expires: Date.now() + 5 * 60 * 1000, // 5 minutes
  })
}

export function verifyOTP(email: string, code: string): boolean {
  const entry = otpStore.get(email.toLowerCase())
  if (!entry) return false
  if (Date.now() > entry.expires) {
    otpStore.delete(email.toLowerCase())
    return false
  }
  if (entry.code !== code) return false
  otpStore.delete(email.toLowerCase())
  return true
}

// ── Session tokens ──
const JWT_SECRET = process.env.JWT_SECRET || 'progrowth-ai-overview-secret-2026'

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

export function verifySessionToken(token: string): { email: string } | null {
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
