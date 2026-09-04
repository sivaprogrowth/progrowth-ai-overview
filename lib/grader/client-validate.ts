/**
 * Client-side form validation for GraderForm (Task 7).
 *
 * Pulled out of the component so it's a plain, dependency-light function
 * that can be unit tested with node:test exactly like the rest of
 * lib/grader — React components aren't unit-testable here without adding
 * a testing-library dependency, which Phase 2 explicitly avoids.
 *
 * Reuses normalizeDomain/FIELD_LIMITS from lib/grader/normalize.ts (the
 * exact Phase 1 server rules) rather than re-implementing them, so this
 * can never silently drift from what POST /api/grader/analyze will
 * actually accept. This is UX only — the server remains the source of
 * truth and re-validates independently.
 */

import { normalizeDomain, FIELD_LIMITS } from './normalize'

export interface GraderFormState {
  domain: string
  companyName: string
  industry: string
  service: string
  location: string
}

export type GraderFormErrors = Partial<Record<keyof GraderFormState, string>>

export function validateGraderForm(form: GraderFormState): GraderFormErrors {
  const errors: GraderFormErrors = {}

  const domainResult = normalizeDomain(form.domain)
  if ('error' in domainResult) {
    errors.domain = 'Please enter a valid website such as example.com'
  }

  if (!form.companyName.trim()) {
    errors.companyName = 'Please enter your company name'
  } else if (form.companyName.trim().length > FIELD_LIMITS.companyName) {
    errors.companyName = `Company name must be ${FIELD_LIMITS.companyName} characters or fewer`
  }

  if (!form.industry.trim()) {
    errors.industry = 'Please enter your industry'
  } else if (form.industry.trim().length > FIELD_LIMITS.industry) {
    errors.industry = `Industry must be ${FIELD_LIMITS.industry} characters or fewer`
  }

  if (form.service.trim().length > FIELD_LIMITS.service) {
    errors.service = `Product / service must be ${FIELD_LIMITS.service} characters or fewer`
  }
  if (form.location.trim().length > FIELD_LIMITS.location) {
    errors.location = `Location must be ${FIELD_LIMITS.location} characters or fewer`
  }

  return errors
}
