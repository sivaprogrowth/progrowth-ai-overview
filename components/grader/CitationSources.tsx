/**
 * "Where AI Gets Information" (Task 20–21). Renders Phase 1's
 * `CitationSummary` verbatim — ranked domains, mentions, coverage, owned
 * vs third-party. No authority score is shown or invented; `sourceType`
 * only renders when the backend classified it (never guessed).
 */

import type { CitationSummary } from '@/lib/grader/types'
import { formatPercent, sourceTypeLabel, wrappableDomain } from '@/lib/grader/format'
import { Card, Pill } from './ui'

export function CitationSources({ citations, domain }: { citations: CitationSummary; domain: string }) {
  if (citations.domains.length === 0) {
    return (
      <Card>
        <p className="text-sm" style={{ color: 'var(--grader-muted-foreground)' }}>
          We didn&rsquo;t find enough citation data to build a reliable source breakdown.
        </p>
      </Card>
    )
  }

  const maxMentions = Math.max(...citations.domains.map((d) => d.mentions), 1)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--grader-muted-foreground)' }}>
            Unique Sources
          </p>
          <p className="mt-2 text-3xl font-extrabold tabular-nums">{citations.uniqueDomains}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--grader-muted-foreground)' }}>
            Third-Party Citation Share
          </p>
          <p className="mt-2 text-3xl font-extrabold tabular-nums">{formatPercent(citations.thirdPartyShare)}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--grader-muted-foreground)' }}>
            Your Domain Citation Share
          </p>
          <p className="mt-2 text-3xl font-extrabold tabular-nums">{formatPercent(citations.ownedShare)}</p>
        </Card>
      </div>

      <Card>
        <ul className="space-y-3">
          {citations.domains.map((d) => (
            <li key={d.domain} className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold" style={{ wordBreak: 'break-word' }}>
                    {d.owned ? domain : wrappableDomain(d.domain)}
                  </span>
                  {d.owned && <Pill tone="accent">Your website</Pill>}
                  {sourceTypeLabel(d.sourceType) && !d.owned && <Pill tone="muted">{sourceTypeLabel(d.sourceType)}</Pill>}
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: 'var(--grader-border)' }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(d.mentions / maxMentions) * 100}%`,
                      backgroundColor: d.owned ? 'var(--grader-accent)' : 'var(--grader-border-muted)',
                    }}
                  />
                </div>
              </div>
              <div className="shrink-0 text-right text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
                <p className="font-semibold" style={{ color: 'var(--grader-foreground)' }}>
                  {d.mentions} mention{d.mentions === 1 ? '' : 's'}
                </p>
                <p>{formatPercent(d.coverage)} coverage</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
