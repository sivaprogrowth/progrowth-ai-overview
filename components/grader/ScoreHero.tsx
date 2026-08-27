/**
 * Report hero — the first thing a visitor sees (Task 13). Shows exactly
 * the Phase 1 outputs: company identity, overall score, grade, and the
 * backend-generated executive summary. Nothing here is recalculated.
 */

import type { GraderReportCompany, ScoreBreakdown } from '@/lib/grader/types'
import { ScoreRing } from './ScoreRing'
import { Pill } from './ui'
import { gradeTone } from '@/lib/grader/format'

export function ScoreHero({
  company,
  score,
  summary,
}: {
  company: GraderReportCompany
  score: ScoreBreakdown
  summary: string
}) {
  return (
    <div className="grader-glow-ambient border-b" style={{ borderColor: 'var(--grader-border)' }}>
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 py-16 text-center sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em]" style={{ color: 'var(--grader-muted-foreground)' }}>
            {company.domain}
          </p>
          <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{company.companyName}</h1>
        </div>

        <ScoreRing score={score.overall} grade={score.grade} size={220} />

        <Pill tone={gradeTone(score.grade)}>{score.grade}</Pill>

        {summary && (
          <p className="max-w-2xl text-base leading-relaxed" style={{ color: 'var(--grader-subtle-foreground)' }}>
            {summary}
          </p>
        )}
      </div>
    </div>
  )
}
