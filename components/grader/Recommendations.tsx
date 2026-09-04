/**
 * "Top Opportunities" (Task 23). Renders Phase 1's `recommendations[]`
 * verbatim, most-severe first (the backend already sorts by priority).
 * No recommendation is added, reworded, or invented on the frontend.
 */

import type { Recommendation } from '@/lib/grader/types'
import { priorityLabel, priorityTone } from '@/lib/grader/format'
import { Card, Pill } from './ui'

export function Recommendations({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
          No specific recommendations were generated for this report.
        </p>
      </Card>
    )
  }

  return (
    <ul className="space-y-4">
      {recommendations.map((rec) => (
        <li key={rec.id}>
          <Card elevated>
            <Pill tone={priorityTone(rec.priority)}>{priorityLabel(rec.priority)}</Pill>
            <h3 className="mt-3 text-lg font-bold">{rec.title}</h3>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--grader-muted-foreground)' }}>
                  Why
                </p>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--grader-subtle-foreground)' }}>
                  {rec.reason}
                </p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--grader-muted-foreground)' }}>
                  What to do
                </p>
                <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--grader-subtle-foreground)' }}>
                  {rec.action}
                </p>
              </div>
            </div>

            {rec.docUrl && (
              <a
                href={rec.docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-xs font-semibold underline decoration-dotted underline-offset-4"
                style={{ color: 'var(--grader-accent-soft)' }}
              >
                Reference: Google Search Central →
              </a>
            )}
          </Card>
        </li>
      ))}
    </ul>
  )
}
