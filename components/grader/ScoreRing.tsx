'use client'

/**
 * Circular score display — a large numeric readout inside a progress ring.
 * Purely presentational: `score`/`grade` are Phase 1 outputs, rendered
 * as-is (Task 14). The ring's fill angle is a direct linear map of
 * score/100, not a recalculation.
 */

import { gradeTone } from '@/lib/grader/format'
import type { GradeLabel } from '@/lib/grader/types'

const TONE_COLOR: Record<ReturnType<typeof gradeTone>, string> = {
  success: 'var(--grader-success)',
  accent: 'var(--grader-accent-soft)',
  warning: 'var(--grader-warning)',
  danger: 'var(--grader-danger)',
}

export function ScoreRing({
  score,
  grade,
  size = 200,
}: {
  score: number
  grade: GradeLabel
  size?: number
}) {
  const stroke = Math.round(size * 0.07)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, score))
  const offset = circumference * (1 - clamped / 100)
  const color = TONE_COLOR[gradeTone(grade)]

  return (
    <div
      role="img"
      aria-label={`AI visibility score: ${Math.round(score)} out of 100, ${grade}`}
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--grader-border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-5xl font-extrabold tabular-nums" style={{ color: 'var(--grader-foreground)' }}>
          {Math.round(score)}
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--grader-muted-foreground)' }}>
          / 100
        </span>
      </div>
    </div>
  )
}
