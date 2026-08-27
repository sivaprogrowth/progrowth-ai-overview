/**
 * "How You Compare" (Task 17). Renders Phase 1's `competitors[]` verbatim
 * as horizontal share-of-voice bars, with the graded brand's own share
 * (100 - sum of competitor shares, floored at 0) shown first and visually
 * distinguished. Never fabricates a competitor or a share value.
 */

import type { CompetitorResult } from '@/lib/grader/types'
import { formatPercent } from '@/lib/grader/format'
import { Card } from './ui'

interface Row {
  name: string
  share: number
  isBrand: boolean
}

export function CompetitorShare({
  companyName,
  competitors,
}: {
  companyName: string
  competitors: CompetitorResult[]
}) {
  if (competitors.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
          We didn&rsquo;t find enough competitor mentions to build a reliable comparison.
        </p>
      </Card>
    )
  }

  const competitorShareTotal = competitors.reduce((sum, c) => sum + c.shareOfVoice, 0)
  const brandShare = Math.max(0, Math.round((100 - competitorShareTotal) * 10) / 10)

  const rows: Row[] = [
    { name: companyName, share: brandShare, isBrand: true },
    ...competitors.map((c) => ({ name: c.name, share: c.shareOfVoice, isBrand: false })),
  ]
  const maxShare = Math.max(...rows.map((r) => r.share), 1)

  return (
    <Card>
      <ul className="space-y-4">
        {rows.map((row) => (
          <li key={row.name}>
            <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
              <span
                className="truncate font-semibold"
                style={{ color: row.isBrand ? 'var(--grader-accent-soft)' : 'var(--grader-foreground)' }}
              >
                {row.name}
                {row.isBrand && (
                  <span className="ml-2 text-xs font-medium" style={{ color: 'var(--grader-muted-foreground)' }}>
                    (you)
                  </span>
                )}
              </span>
              <span className="shrink-0 tabular-nums" style={{ color: 'var(--grader-muted-foreground)' }}>
                {formatPercent(row.share)}
              </span>
            </div>
            <div
              className="h-2.5 w-full overflow-hidden rounded-full"
              style={{ backgroundColor: 'var(--grader-border)' }}
              role="progressbar"
              aria-valuenow={row.share}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${row.name} share of voice`}
            >
              <div
                className="h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none"
                style={{
                  width: `${(row.share / maxShare) * 100}%`,
                  backgroundImage: row.isBrand ? 'var(--grader-accent-gradient)' : undefined,
                  backgroundColor: row.isBrand ? undefined : 'var(--grader-border-muted)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
