/**
 * Lead-capture validation for POST /api/grader/lead (Phase 2, Task 27).
 *
 * Mirrors the shape and rigor of lib/grader/normalize.ts: collect every
 * problem rather than failing fast, cap lengths so public input can't
 * bloat the row, and never trust the caller's claim about which report
 * they're attached to (the route re-checks the report actually exists).
 */

const NAME_MAX = 150
/** RFC 5321 §4.5.3.1.3 total mailbox length ceiling. */
const EMAIL_MAX = 254

// Deliberately permissive (structure, not deliverability) — the same
// philosophy as normalize.ts's domain check: reject what's clearly wrong,
// don't try to be a full RFC 5322 parser.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export interface LeadInput {
  reportId: unknown
  name: unknown
  email: unknown
}

export interface NormalizedLead {
  reportId: string
  name: string
  email: string
}

export interface LeadIssue {
  field: 'reportId' | 'name' | 'email' | 'input'
  message: string
}

export type NormalizeLeadResult =
  | { ok: true; value: NormalizedLead }
  | { ok: false; issues: LeadIssue[] }

function trimField(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''
}

export function normalizeLeadInput(raw: unknown): NormalizeLeadResult {
  const issues: LeadIssue[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, issues: [{ field: 'input', message: 'request body must be a JSON object' }] }
  }
  const body = raw as Partial<Record<keyof LeadInput, unknown>>

  const reportId = trimField(body.reportId)
  if (!reportId) issues.push({ field: 'reportId', message: 'reportId is required' })

  const name = trimField(body.name)
  if (!name) {
    issues.push({ field: 'name', message: 'name is required' })
  } else if (name.length > NAME_MAX) {
    issues.push({ field: 'name', message: `name must be ${NAME_MAX} characters or fewer` })
  }

  const email = trimField(body.email).toLowerCase()
  if (!email) {
    issues.push({ field: 'email', message: 'email is required' })
  } else if (email.length > EMAIL_MAX) {
    issues.push({ field: 'email', message: `email must be ${EMAIL_MAX} characters or fewer` })
  } else if (!EMAIL_RE.test(email)) {
    issues.push({ field: 'email', message: 'please enter a valid email address' })
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, value: { reportId, name, email } }
}
