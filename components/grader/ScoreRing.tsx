'use client'

/**
 * Circular progress ring — a large numeric readout inside a progress arc.
 * Purely presentational and generic: the caller supplies the percentage to
 * fill, the tone, and the exact text to show in the center. This is what
 * lets the SAME component serve both the overall score ring (percent =
 * score/100, text = the score) and each engine's ring in the multi-engine
 * scorecard (percent = mention rate, text = "mentioned / answered") without
 * a second near-identical component (multi-engine scorecard Task 17) —
 * neither call site's *values* are computed here; both are pure Phase 1/2
 * outputs already computed by lib/grader/scoring.ts or lib/grader/format.ts.
 */

import type { Tone } from './ui'

const TONE_COLOR: Record<Tone, string> = {
  success: 'var(--grader-success)',
  accent: 'var(--grader-accent-soft)',
  warning: 'var(--grader-warning)',
  danger: 'var(--grader-danger)',
  muted: 'var(--grader-border-muted)',
}

export function ScoreRing({
  percent,
  tone,
  size = 200,
  primaryText,
  secondaryText,
  ariaLabel,
}: {
  /** 0–100 — drives the arc fill. Never recalculated here. */
  percent: number
  tone: Tone
  size?: number
  /** Large center text, e.g. "72" or "7". */
  primaryText: string
  /** Small text under the primary text, e.g. "/ 100" or "/ 10". */
  secondaryText?: string
  /** Full accessible description — e.g. "AI visibility score: 72 out of 100, Strong". */
  ariaLabel: string
}) {
  const stroke = Math.round(size * 0.07)
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, percent))
  const offset = circumference * (1 - clamped / 100)
  const color = TONE_COLOR[tone]
  const primaryFontSize = size >= 180 ? '3rem' : size >= 130 ? '2rem' : '1.5rem'

  return (
    <div
      role="img"
      aria-label={ariaLabel}
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
        <span
          className="font-extrabold tabular-nums"
          style={{ color: 'var(--grader-foreground)', fontSize: primaryFontSize, lineHeight: 1 }}
        >
          {primaryText}
        </span>
        {secondaryText && (
          <span className="mt-1 text-xs font-medium" style={{ color: 'var(--grader-muted-foreground)' }}>
            {secondaryText}
          </span>
        )}
      </div>
    </div>
  )
}
