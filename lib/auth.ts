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

// ── Session tokens ──
export function createSessionToken(email: string, sessionId: string): string {
  const payload = {
    email,
    sessionId,
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
  }
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64url')
  return `${data}.${sig}`
}
