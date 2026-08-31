'use client'

/**
 * Premium "analysis in progress" moment shown while POST /api/grader/analyze
 * is in flight (Task 9, Phase 3 polish). The API is synchronous and exposes
 * no stage-level progress events, so this deliberately does NOT:
 *   - show a percentage
 *   - claim any specific step has completed
 *   - fabricate a fake multi-step wizard with checkmarks
 *
 * Instead it cycles a gentle highlight through an honest "what we're
 * analyzing" list — reassurance that the product is working, without
 * pretending to know real backend state. The list names the three engines
 * the backend actually queries (lib/grader/dataforseo.ts's GRADER_ENGINES)
 * and nothing else — never Gemini/Grok/Google AI Overview, which this
 * product does not analyze. Respects prefers-reduced-motion by holding a
 * static highlight instead of cycling (this file's own check, plus the
 * blanket `@media (prefers-reduced-motion)` kill-switch in
 * app/grader/grader-theme.css, which zeroes every animation/transition
 * duration under .grader-theme regardless).
 *
 * Timing copy ("about a minute") reflects Phase 2's measured 8-query
 * behavior (live runs observed at 39–54s), not a promise or a countdown —
 * see the Phase 2/3 performance reports for the underlying numbers.
 */

import { useEffect, useState } from 'react'
import { Card } from './ui'

/** The exact three engines lib/grader/dataforseo.ts's GRADER_ENGINES
 *  queries — kept in sync manually since this list is copy, not derived
 *  from a report (there is no report yet at this point in the flow). */
const ANALYSIS_ITEMS = [
  'Preparing buyer-intent questions',
  'Checking ChatGPT',
  'Checking Perplexity',
  'Checking Claude',
  'Analyzing citations and competitors',
  'Evaluating AI readiness',
  'Building your visibility score',
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
        We&rsquo;re running real, live queries against ChatGPT, Perplexity, and Claude, then
        analyzing the citations, competitors, and signals behind those answers. This usually
        takes about a minute — please keep this tab open.
      </p>

      <Card className="mt-8 w-full text-left" elevated>
        <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--grader-accent-soft)' }}>
          What we&rsquo;re analyzing
        </p>
        <ul className="space-y-3">
          {ANALYSIS_ITEMS.map((item, i) => {
            const isActive = i === active
            return (
              <li
                key={item}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors duration-500 motion-reduce:transition-none"
                style={{
                  color: isActive ? 'var(--grader-foreground)' : 'var(--grader-muted-foreground)',
                  backgroundColor: isActive ? 'var(--grader-glow-soft)' : 'transparent',
                }}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'motion-safe:animate-pulse' : ''}`}
                  style={{ backgroundColor: isActive ? 'var(--grader-accent-soft)' : 'var(--grader-border-muted)' }}
                  aria-hidden="true"
                />
                {item}
              </li>
            )
          })}
        </ul>
      </Card>
    </div>
  )
}
