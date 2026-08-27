/**
 * "Your AI Presence" (Task 16). Renders per-engine mention counts derived
 * from the query results by lib/grader/format.ts's aggregateEnginePresence
 * — a straight count over already-returned per-engine answers, always
 * shown alongside the factual "mentioned in X of Y" count rather than the
 * bucket label alone.
 */

import type { QueryAnalysisResult } from '@/lib/grader/types'
import { aggregateEnginePresence, engineLabel, presenceTone } from '@/lib/grader/format'
import { Card, Pill } from './ui'

export function EngineVisibility({ queries }: { queries: QueryAnalysisResult[] }) {
  const rows = aggregateEnginePresence(queries)

  if (rows.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
          No answer engines returned a usable response for this analysis.
        </p>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {rows.map((row) => (
        <Card key={row.engine}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold">{engineLabel(row.engine)}</h3>
            <Pill tone={presenceTone(row.label)}>{row.label}</Pill>
          </div>
          <p className="mt-3 text-2xl font-extrabold tabular-nums">
            {row.mentionedCount}
            <span className="text-sm font-medium" style={{ color: 'var(--grader-muted-foreground)' }}>
              {' '}
              / {row.answeredCount}
            </span>
          </p>
          <p className="mt-1 text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
            queries mentioned your brand
          </p>
        </Card>
      ))}
    </div>
  )
}
