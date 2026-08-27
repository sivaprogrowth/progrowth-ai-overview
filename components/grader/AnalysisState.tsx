'use client'

/**
 * Premium "analysis in progress" moment shown while POST /api/grader/analyze
 * is in flight (Task 9). The Phase 1 API is synchronous and exposes no
 * stage-level progress events, so this deliberately does NOT:
 *   - show a percentage
 *   - claim any specific step has completed
 *   - fabricate a fake multi-step wizard with checkmarks
 *
 * Instead it cycles a gentle highlight through a neutral "what we're
 * analyzing" list — reassurance that the product is working, without
 * pretending to know real backend state. Respects prefers-reduced-motion
 * by holding a static highlight instead of cycling.
 */

import { useEffect, useState } from 'react'
import { Card } from './ui'

const ANALYSIS_ITEMS = [
  'Brand visibility across AI answer engines',
  'Competitive mentions and share of voice',
  'Citation and source coverage',
  'Buyer-intent query coverage',
  'AI readiness signals',
]

const CYCLE_MS = 2200

export function AnalysisState({ companyName }: { companyName: string }) {
  const [active, setActive] = useState(0)

  useEffect(() => {
    const prefersReducedMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    const interval = setInterval(() => {
      setActive((i) => (i + 1) % ANALYSIS_ITEMS.length)
    }, CYCLE_MS)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-16 text-center" role="status" aria-live="polite">
      <div
        className="mb-6 h-14 w-14 animate-spin rounded-full border-2 border-transparent motion-reduce:animate-none"
        style={{
          borderTopColor: 'var(--grader-accent-soft)',
          borderRightColor: 'var(--grader-border)',
          borderBottomColor: 'var(--grader-border)',
          borderLeftColor: 'var(--grader-border)',
        }}
        aria-hidden="true"
      />
      <h2 className="text-xl font-bold sm:text-2xl">
        Analyzing {companyName || 'your brand'}&rsquo;s AI visibility
      </h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
        This runs real, live queries against AI answer engines — it usually takes a
        couple of minutes. Please keep this tab open.
      </p>

      <Card className="mt-8 w-full text-left" elevated>
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--grader-accent-soft)' }}>
          What we&rsquo;re analyzing
        </p>
        <ul className="space-y-3">
          {ANALYSIS_ITEMS.map((item, i) => (
            <li
              key={item}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-500 motion-reduce:transition-none"
              style={{
                color: i === active ? 'var(--grader-foreground)' : 'var(--grader-muted-foreground)',
                backgroundColor: i === active ? 'var(--grader-glow-soft)' : 'transparent',
              }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: i === active ? 'var(--grader-accent-soft)' : 'var(--grader-border-muted)' }}
                aria-hidden="true"
              />
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
