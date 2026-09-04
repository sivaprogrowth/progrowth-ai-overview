'use client'

/**
 * "Questions That Matter" (Task 18–19). Renders Phase 1's per-query
 * results as cards with simple category filtering — a report, not an
 * operations data table, so filtering is four buttons, not a grid with
 * sort/search/pagination.
 */

import { useMemo, useState } from 'react'
import type { QueryAnalysisResult, QueryCategory } from '@/lib/grader/types'
import { categoryLabel, engineLabel } from '@/lib/grader/format'
import { Card, Pill, StatusDot } from './ui'

const FILTERS: Array<{ id: 'all' | QueryCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'brand_evaluation', label: 'Brand' },
  { id: 'category_discovery', label: 'Discovery' },
  { id: 'recommendation_intent', label: 'Recommendation' },
  { id: 'alternatives_comparison', label: 'Comparison' },
]

export function QueryResults({ queries }: { queries: QueryAnalysisResult[] }) {
  const [filter, setFilter] = useState<'all' | QueryCategory>('all')

  const filtered = useMemo(
    () => (filter === 'all' ? queries : queries.filter((q) => q.category === filter)),
    [queries, filter]
  )

  const availableFilters = useMemo(
    () => FILTERS.filter((f) => f.id === 'all' || queries.some((q) => q.category === f.id)),
    [queries]
  )

  if (queries.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
          No queries were analyzed for this report.
        </p>
      </Card>
    )
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter questions by category">
        {availableFilters.map((f) => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className="rounded-full border px-4 py-1.5 text-xs font-semibold transition-colors duration-150 motion-reduce:transition-none"
              style={{
                borderColor: active ? 'var(--grader-accent)' : 'var(--grader-border)',
                color: active ? 'var(--grader-foreground)' : 'var(--grader-muted-foreground)',
                backgroundColor: active ? 'var(--grader-glow-soft)' : 'transparent',
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      <ul className="space-y-4">
        {filtered.map((q) => (
          <li key={q.query}>
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="max-w-2xl text-sm font-semibold leading-snug">{q.query}</h3>
                <Pill tone="muted">{categoryLabel(q.category)}</Pill>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                {q.brandMentioned ? (
                  <>
                    <StatusDot tone="success" />
                    <span style={{ color: 'var(--grader-foreground)' }}>
                      Mentioned{q.brandPosition ? ` — position #${q.brandPosition}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <StatusDot tone="muted" />
                    <span style={{ color: 'var(--grader-muted-foreground)' }}>Not mentioned</span>
                  </>
                )}
              </div>

              {q.enginesAnswered.length > 0 && (
                <p className="mt-3 text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
                  Checked on {q.enginesAnswered.map(engineLabel).join(', ')}
                </p>
              )}

              {q.competitors.length > 0 && (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
                  Also mentioned: {q.competitors.slice(0, 4).join(', ')}
                  {q.competitors.length > 4 ? ` +${q.competitors.length - 4} more` : ''}
                </p>
              )}

              {q.citations.length > 0 && (
                <p className="mt-1.5 text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
                  {q.citations.length} source{q.citations.length === 1 ? '' : 's'} cited
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
