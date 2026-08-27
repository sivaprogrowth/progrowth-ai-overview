/**
 * "AI Readiness" (Task 22). Renders Phase 1's `ReadinessResult.checks[]`
 * verbatim. `passed === null` always renders as "Not evaluated", never as
 * a failure — an unreachable check is not evidence of a problem.
 */

import type { ReadinessResult } from '@/lib/grader/types'
import { readinessStatusLabel, readinessTone } from '@/lib/grader/format'
import { Card, Pill, StatusDot } from './ui'

export function ReadinessChecklist({ readiness }: { readiness: ReadinessResult }) {
  if (readiness.status === 'unavailable' || readiness.checks.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
          AI readiness checks were unavailable for this site during this analysis
          {readiness.error ? ` (${readiness.error})` : ''}.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {readiness.status === 'partial' && (
        <Pill tone="warning">Some readiness checks could not be evaluated</Pill>
      )}
      <Card>
        <ul className="divide-y" style={{ borderColor: 'var(--grader-border)' }}>
          {readiness.checks.map((check) => (
            <li key={check.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <StatusDot tone={readinessTone(check.passed)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{check.label}</span>
                  <Pill tone={readinessTone(check.passed)}>{readinessStatusLabel(check.passed)}</Pill>
                </div>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
                  {check.detail}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
