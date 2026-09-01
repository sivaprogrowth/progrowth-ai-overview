'use client'

/**
 * Final CTA (Task 31). Links to the confirmed ProGrowth marketing domain —
 * the repo has no other booking/contact URL to reuse (checked: README only
 * references the internal tool's own login-gated subdomain). Phase 3 asked
 * to confirm this is the correct production conversion destination — it
 * remains the answer confirmed at the start of Phase 2, since no
 * dedicated /book-demo, /contact, or scheduling URL exists anywhere in
 * this repo to prefer instead.
 */

import { trackGraderEvent } from '@/lib/grader/analytics'
import { PrimaryButton } from './ui'

const PROGROWTH_URL = 'https://progrowth.services'

export function ReportCTA() {
  return (
    <div className="grader-glow-ambient border-t" style={{ borderColor: 'var(--grader-border)' }}>
      <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 sm:py-28 lg:px-8">
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.25em]" style={{ color: 'var(--grader-accent-soft)' }}>
          Ready When You Are
        </p>
        <h2 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Want to{' '}
          <em
            className="font-medium not-italic"
            style={{
              fontFamily: 'var(--grader-font-display)',
              fontStyle: 'italic',
              backgroundImage: 'var(--grader-accent-gradient)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            improve
          </em>{' '}
          your AI visibility?
        </h2>
        <p
          className="mx-auto mt-5 max-w-xl text-base leading-relaxed sm:text-lg"
          style={{ color: 'var(--grader-subtle-foreground)' }}
        >
          ProGrowth helps companies improve how they appear, get cited, and get
          recommended across AI-powered search.
        </p>
        <div className="mt-10">
          <PrimaryButton href={PROGROWTH_URL} onClick={() => trackGraderEvent('grader_cta_clicked')}>
            Talk to ProGrowth
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}
