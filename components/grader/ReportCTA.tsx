/**
 * Final CTA (Task 31). Links to the confirmed ProGrowth marketing domain —
 * the repo has no other booking/contact URL to reuse (checked: README only
 * references the internal tool's own login-gated subdomain).
 */

import { PrimaryButton } from './ui'

const PROGROWTH_URL = 'https://progrowth.services'

export function ReportCTA() {
  return (
    <div className="border-t" style={{ borderColor: 'var(--grader-border)' }}>
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold sm:text-3xl">Want to improve your AI visibility?</h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed" style={{ color: 'var(--grader-muted-foreground)' }}>
          ProGrowth helps companies improve how they appear, get cited, and get
          recommended across AI-powered search.
        </p>
        <div className="mt-8">
          <PrimaryButton href={PROGROWTH_URL}>Talk to ProGrowth</PrimaryButton>
        </div>
      </div>
    </div>
  )
}
