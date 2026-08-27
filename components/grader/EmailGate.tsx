'use client'

/**
 * Lead capture gate (Tasks 25–28). Shown after the score preview and
 * before the rest of the report. On success it calls `onUnlock`, which the
 * parent (ReportView) uses to reveal the already-fetched report data and
 * persist the unlock in localStorage — the report itself was already
 * retrieved from Phase 1 and is never re-fetched or lost on a save
 * failure (Task 28): a failed lead save shows a retry, nothing else.
 */

import { useState, type FormEvent } from 'react'
import { Card, PrimaryButton, SecondaryButton } from './ui'

const TEASER_ITEMS = [
  'Competitor share of voice',
  'Citation and source analysis',
  'Query-level visibility across AI engines',
  'Prioritized recommendations',
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function EmailGate({ reportId, onUnlock }: { reportId: string; onUnlock: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: { name?: string; email?: string } = {}
    if (!name.trim()) nextErrors.name = 'Please enter your name'
    if (!email.trim()) nextErrors.email = 'Please enter your work email'
    else if (!EMAIL_RE.test(email.trim())) nextErrors.email = 'Please enter a valid email address'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setServerError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/grader/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, name: name.trim(), email: email.trim() }),
      })
      if (res.status === 429) {
        setServerError('Too many attempts — please try again in a minute.')
        setSubmitting(false)
        return
      }
      if (!res.ok) {
        setServerError("We couldn't save your details. Please try again.")
        setSubmitting(false)
        return
      }
      onUnlock()
    } catch {
      setServerError("We couldn't reach the server. Please check your connection and try again.")
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10 sm:px-6 lg:px-8">
      <Card elevated>
        <p className="text-sm font-semibold" style={{ color: 'var(--grader-accent-soft)' }}>
          Unlock your complete report to see:
        </p>
        <ul className="mt-3 space-y-2">
          {TEASER_ITEMS.map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm" style={{ color: 'var(--grader-subtle-foreground)' }}>
              <span aria-hidden="true" style={{ color: 'var(--grader-accent-soft)' }}>
                •
              </span>
              {item}
            </li>
          ))}
        </ul>

        {serverError && (
          <div
            role="alert"
            className="mt-5 rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: 'var(--grader-danger)', color: 'var(--grader-danger)', backgroundColor: 'color-mix(in srgb, var(--grader-danger) 10%, transparent)' }}
          >
            <p>{serverError}</p>
            <div className="mt-3">
              <SecondaryButton onClick={() => setServerError(null)}>Try again</SecondaryButton>
            </div>
          </div>
        )}

        {!serverError && (
          <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
            <div>
              <label htmlFor="lead-name" className="mb-1.5 block text-sm font-semibold">
                Name
              </label>
              <input
                id="lead-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'lead-name-error' : undefined}
                className="w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[color:var(--grader-accent)] focus:border-[color:var(--grader-accent)]"
                style={{ borderColor: errors.name ? 'var(--grader-danger)' : 'var(--grader-border)' }}
              />
              {errors.name && (
                <p id="lead-name-error" role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--grader-danger)' }}>
                  {errors.name}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="lead-email" className="mb-1.5 block text-sm font-semibold">
                Work Email
              </label>
              <input
                id="lead-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? 'lead-email-error' : undefined}
                className="w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[color:var(--grader-accent)] focus:border-[color:var(--grader-accent)]"
                style={{ borderColor: errors.email ? 'var(--grader-danger)' : 'var(--grader-border)' }}
              />
              {errors.email && (
                <p id="lead-email-error" role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--grader-danger)' }}>
                  {errors.email}
                </p>
              )}
            </div>
            <PrimaryButton type="submit" fullWidth disabled={submitting}>
              {submitting ? 'Unlocking…' : 'Unlock Full Report'}
            </PrimaryButton>
          </form>
        )}
      </Card>
    </div>
  )
}
