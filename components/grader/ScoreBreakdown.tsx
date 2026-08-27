/**
 * Score breakdown — renders lib/grader/scoring.ts's `ScoreCategory[]`
 * verbatim (Task 15): earned score, max, and the backend's own `detail`
 * string. No explanatory number here is invented on the frontend.
 */

import type { ScoreCategory } from '@/lib/grader/types'
import { Card } from './ui'

function categoryTone(ratio: number): string {
  if (ratio >= 0.75) return 'var(--grader-success)'
  if (ratio >= 0.4) return 'var(--grader-warning)'
  return 'var(--grader-danger)'
}

export function ScoreBreakdown({ categories }: { categories: ScoreCategory[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {categories.map((category) => {
        const ratio = category.max > 0 ? category.score / category.max : 0
        const tone = categoryTone(ratio)
        return (
          <Card key={category.id}>
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-sm font-bold" style={{ color: 'var(--grader-foreground)' }}>
                {category.label}
              </h3>
              <span className="whitespace-nowrap text-lg font-extrabold tabular-nums" style={{ color: tone }}>
                {category.score}
                <span className="text-xs font-medium" style={{ color: 'var(--grader-muted-foreground)' }}>
                  {' '}
                  / {category.max}
                </span>
              </span>
            </div>
            <div
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: 'var(--grader-border)' }}
              role="progressbar"
              aria-valuenow={category.score}
              aria-valuemin={0}
              aria-valuemax={category.max}
              aria-label={`${category.label} score`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{ width: `${Math.min(100, ratio * 100)}%`, backgroundColor: tone }}
              />
            </div>
            <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--grader-muted-foreground)' }}>
              {category.detail}
            </p>
          </Card>
        )
      })}
    </div>
  )
}
