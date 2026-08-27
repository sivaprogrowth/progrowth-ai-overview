'use client'

/**
 * The primary grader submission form (Tasks 5–8).
 *
 * Client-side validation reuses the EXACT Phase 1 domain rules
 * (normalizeDomain / FIELD_LIMITS from lib/grader/normalize.ts, which is a
 * dependency-free leaf safe to bundle client-side) rather than
 * reimplementing them — so the inline "please enter a valid website"
 * feedback can never drift from what the server will actually accept. The
 * server remains the source of truth: this only improves UX, it never
 * replaces POST /api/grader/analyze's own validation (Task 7).
 */

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { validateGraderForm, type GraderFormState } from '@/lib/grader/client-validate'
import { trackGraderEvent } from '@/lib/grader/analytics'
import { AnalysisState } from './AnalysisState'
import { Card, PrimaryButton, SecondaryButton } from './ui'

type FormState = GraderFormState

const EMPTY_FORM: FormState = { domain: '', companyName: '', industry: '', service: '', location: '' }

type FieldErrors = Partial<Record<keyof FormState, string>>

function inputClassName(hasError: boolean): string {
  return [
    'w-full rounded-xl border bg-transparent px-4 py-3 text-sm outline-none transition-colors duration-150',
    'placeholder:text-[color:var(--grader-muted-foreground)]',
    'focus:ring-2 focus:ring-offset-0 focus:ring-[color:var(--grader-accent)]',
    hasError ? 'border-[color:var(--grader-danger)]' : 'border-[color:var(--grader-border)] focus:border-[color:var(--grader-accent)]',
  ].join(' ')
}

export function GraderForm() {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    trackGraderEvent('grader_viewed')
  }, [])

  function setField<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const validationErrors = validateGraderForm(form)
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) return

    setFailure(null)
    setSubmitting(true)
    trackGraderEvent('grader_submitted', { industry: form.industry.trim().slice(0, 60) })

    try {
      const res = await fetch('/api/grader/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: form.domain.trim(),
          companyName: form.companyName.trim(),
          industry: form.industry.trim(),
          service: form.service.trim() || undefined,
          location: form.location.trim() || undefined,
        }),
      })

      if (res.status === 429) {
        // Two distinct server-side guards return 429 (rate limit and the
        // duplicate-submission guard) — both already produce a safe,
        // specific, public-facing message server-side, so it's shown
        // as-is rather than replaced with one generic string.
        const body = await res.json().catch(() => null)
        setSubmitting(false)
        setFailure(body?.error || "You've run several reports recently. Please try again in a little while.")
        return
      }

      if (res.status === 503) {
        setSubmitting(false)
        setFailure("We're unable to run another analysis right now. Please try again later.")
        return
      }

      if (res.status === 400) {
        const body = await res.json().catch(() => null)
        setSubmitting(false)
        setFailure(
          body?.error === 'Invalid input'
            ? "We couldn't analyze that website. Please check your details and try again."
            : "We couldn't process that request. Please check your details and try again."
        )
        return
      }

      if (!res.ok) {
        setSubmitting(false)
        setFailure("We couldn't complete this analysis right now. Please try again.")
        return
      }

      const data = await res.json()

      if (data.status === 'completed' || data.status === 'partial') {
        trackGraderEvent(data.status === 'completed' ? 'grader_analysis_completed' : 'grader_analysis_partial')
        router.push(`/grader/report/${data.reportId}`)
        return
      }

      // status === 'failed' — the run persisted, but produced no usable
      // report. Stay on the form with a retry path rather than navigating
      // to a report page with nothing to show (Task 8).
      trackGraderEvent('grader_analysis_failed')
      setSubmitting(false)
      setFailure("We couldn't complete this analysis. Nothing was charged, and no data was retained beyond this attempt. Please try again.")
    } catch {
      trackGraderEvent('grader_analysis_failed', { reason: 'network' })
      setSubmitting(false)
      setFailure('We couldn’t reach the server. Please check your connection and try again.')
    }
  }

  if (submitting) {
    return <AnalysisState companyName={form.companyName} />
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-24">
      <Card elevated>
        {failure && (
          <div
            role="alert"
            className="mb-6 rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: 'var(--grader-danger)', color: 'var(--grader-danger)', backgroundColor: 'color-mix(in srgb, var(--grader-danger) 10%, transparent)' }}
          >
            <p>{failure}</p>
            <div className="mt-3">
              <SecondaryButton onClick={() => setFailure(null)}>Try again</SecondaryButton>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div>
            <label htmlFor="domain" className="mb-1.5 block text-sm font-semibold">
              Website <span aria-hidden="true" style={{ color: 'var(--grader-danger)' }}>*</span>
            </label>
            <input
              id="domain"
              name="domain"
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="example.com"
              value={form.domain}
              onChange={(e) => setField('domain', e.target.value)}
              className={inputClassName(!!errors.domain)}
              aria-invalid={!!errors.domain}
              aria-describedby={errors.domain ? 'domain-error' : undefined}
            />
            {errors.domain && (
              <p id="domain-error" role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--grader-danger)' }}>
                {errors.domain}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="companyName" className="mb-1.5 block text-sm font-semibold">
              Company Name <span aria-hidden="true" style={{ color: 'var(--grader-danger)' }}>*</span>
            </label>
            <input
              id="companyName"
              name="companyName"
              type="text"
              autoComplete="organization"
              placeholder="Example Company"
              value={form.companyName}
              onChange={(e) => setField('companyName', e.target.value)}
              className={inputClassName(!!errors.companyName)}
              aria-invalid={!!errors.companyName}
              aria-describedby={errors.companyName ? 'companyName-error' : undefined}
            />
            {errors.companyName && (
              <p id="companyName-error" role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--grader-danger)' }}>
                {errors.companyName}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div>
              <label htmlFor="industry" className="mb-1.5 block text-sm font-semibold">
                Industry <span aria-hidden="true" style={{ color: 'var(--grader-danger)' }}>*</span>
              </label>
              <input
                id="industry"
                name="industry"
                type="text"
                placeholder="Insurance"
                value={form.industry}
                onChange={(e) => setField('industry', e.target.value)}
                className={inputClassName(!!errors.industry)}
                aria-invalid={!!errors.industry}
                aria-describedby={errors.industry ? 'industry-error' : undefined}
              />
              {errors.industry && (
                <p id="industry-error" role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--grader-danger)' }}>
                  {errors.industry}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="location" className="mb-1.5 block text-sm font-semibold">
                Target Location
              </label>
              <input
                id="location"
                name="location"
                type="text"
                autoComplete="address-level1"
                placeholder="United States"
                value={form.location}
                onChange={(e) => setField('location', e.target.value)}
                className={inputClassName(!!errors.location)}
                aria-invalid={!!errors.location}
                aria-describedby={errors.location ? 'location-error' : undefined}
              />
              {errors.location && (
                <p id="location-error" role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--grader-danger)' }}>
                  {errors.location}
                </p>
              )}
            </div>
          </div>

          <div>
            <label htmlFor="service" className="mb-1.5 block text-sm font-semibold">
              Product / Service
            </label>
            <input
              id="service"
              name="service"
              type="text"
              placeholder="Commercial Insurance"
              value={form.service}
              onChange={(e) => setField('service', e.target.value)}
              className={inputClassName(!!errors.service)}
              aria-invalid={!!errors.service}
              aria-describedby={errors.service ? 'service-error' : undefined}
            />
            {errors.service && (
              <p id="service-error" role="alert" className="mt-1.5 text-xs" style={{ color: 'var(--grader-danger)' }}>
                {errors.service}
              </p>
            )}
          </div>

          <PrimaryButton type="submit" fullWidth>
            Analyze My AI Visibility
          </PrimaryButton>
          <p className="text-center text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
            Free analysis. Takes about a minute or two.
          </p>
        </form>
      </Card>
    </div>
  )
}
