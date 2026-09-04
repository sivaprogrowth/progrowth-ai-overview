/**
 * "AI Engine Performance" — the multi-engine visual scorecard that now
 * appears immediately after the Score Hero (Tasks 2, 11). Supersedes the
 * old EngineVisibility ("Your AI Presence") section entirely: everything
 * that showed is a strict subset of what this shows, so keeping both would
 * repeat the exact same chart (Task 18/19 — top scorecard = summary, lower
 * sections = detail, never duplicated).
 *
 * The grid adapts to how many engines actually returned data (Task 12) —
 * never forces empty placeholder columns for an engine that was never
 * queried at all. An engine that WAS queried but failed on every single
 * call still gets a card (EngineScoreCard's "unavailable" state, Task 21) —
 * only an engine with zero attempted calls is omitted.
 */

import type { EngineSummary } from '@/lib/grader/format'
import { EngineScoreCard } from './EngineScoreCard'
import { Card } from './ui'

export function MultiEngineScorecard({ summaries }: { summaries: EngineSummary[] }) {
  if (summaries.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
          No answer engines returned a usable response for this analysis.
        </p>
      </Card>
    )
  }

  // Never force empty placeholder columns for engines that weren't queried
  // at all (Task 12) — the column count tracks how many cards actually
  // exist, not the maximum the product could theoretically support.
  const gridClass =
    summaries.length === 1
      ? 'mx-auto max-w-sm grid-cols-1'
      : summaries.length === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'

  return (
    <div className={`grid gap-4 ${gridClass}`}>
      {summaries.map((summary) => (
        <EngineScoreCard key={summary.engine} summary={summary} />
      ))}
    </div>
  )
}
