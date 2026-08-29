/**
 * One engine's card in the multi-engine scorecard (Tasks 4–9, 21).
 *
 * The ring visualizes the ENGINE'S MENTION RATE (mentioned/answered), not
 * an invented per-engine score — the backend has no per-engine score to
 * show (lib/grader/scoring.ts computes one score across all engines
 * combined), and fabricating one here would be exactly the "new scoring
 * model in the frontend" the brief forbids. The ring's center text is the
 * same honest "X / Y" the metric rows repeat, just made visually
 * prominent, matching the reference's visual weight without its numbers.
 */

import { engineLabel, engineTagline, engineInterpretation, presenceTone, formatPercent, type EngineSummary } from '@/lib/grader/format'
import { Card, Pill } from './ui'
import { ScoreRing } from './ScoreRing'
import { EngineMetricRow } from './EngineMetricRow'

export function EngineScoreCard({ summary }: { summary: EngineSummary }) {
  const tone = presenceTone(summary.label)

  if (!summary.available) {
    return (
      <Card elevated className="flex flex-col items-center text-center">
        <h3 className="text-base font-bold">{engineLabel(summary.engine)}</h3>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
          {engineTagline(summary.engine)}
        </p>
        <div
          className="mt-6 flex h-32 w-32 items-center justify-center rounded-full border-2 border-dashed"
          style={{ borderColor: 'var(--grader-border-muted)' }}
          role="img"
          aria-label={`${engineLabel(summary.engine)}: data unavailable for this analysis`}
        >
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--grader-muted-foreground)' }}>
            Unavailable
          </span>
        </div>
        <p className="mt-6 text-sm leading-relaxed" style={{ color: 'var(--grader-muted-foreground)' }}>
          {engineInterpretation(summary)}
        </p>
      </Card>
    )
  }

  return (
    <Card elevated className="flex flex-col items-center text-center">
      <h3 className="text-base font-bold">{engineLabel(summary.engine)}</h3>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--grader-muted-foreground)' }}>
        {engineTagline(summary.engine)}
      </p>

      <div className="mt-6">
        <ScoreRing
          percent={summary.mentionRate}
          tone={tone}
          size={140}
          primaryText={String(summary.mentionedCount)}
          secondaryText={`/ ${summary.answeredCount}`}
          ariaLabel={`${engineLabel(summary.engine)} visibility: ${summary.mentionedCount} out of ${summary.answeredCount} analyzed prompts mentioned your brand`}
        />
      </div>

      <div className="mt-4">
        <Pill tone={tone}>{summary.label}</Pill>
      </div>

      <div className="mt-6 w-full text-left" style={{ borderTop: '1px solid var(--grader-border)' }}>
        <EngineMetricRow
          label="Brand Mentions"
          value={`${summary.mentionedCount} / ${summary.answeredCount}`}
          percent={summary.mentionRate}
          ariaLabel={`${engineLabel(summary.engine)} brand mentions: ${summary.mentionedCount} out of ${summary.answeredCount} analyzed prompts`}
        />
        <EngineMetricRow
          label="Citation Coverage"
          value={formatPercent(summary.citationCoveragePercent ?? 0)}
          percent={summary.citationCoveragePercent ?? 0}
          ariaLabel={`${engineLabel(summary.engine)} citation coverage: ${formatPercent(summary.citationCoveragePercent ?? 0)}`}
        />
        <EngineMetricRow
          label="Avg. Position"
          value={summary.avgPosition !== null ? `#${summary.avgPosition}` : 'Not cited'}
        />
        <EngineMetricRow
          label="Competitors Mentioned"
          value={`${summary.uniqueCompetitors}`}
        />
      </div>

      <p className="mt-6 text-sm leading-relaxed" style={{ color: 'var(--grader-subtle-foreground)' }}>
        {engineInterpretation(summary)}
      </p>
    </Card>
  )
}
