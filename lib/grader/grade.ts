/**
 * Grade bands — the single source of truth for score → label.
 *
 * Kept in its own leaf module so no threshold is ever duplicated: scoring,
 * recommendations, the summary generator and (later) the UI all read from
 * here. Dependency-free.
 */

import type { GradeLabel } from './types'

/** Inclusive lower bound of each band, highest first. */
export const GRADE_BANDS: Array<{ min: number; label: GradeLabel }> = [
  { min: 90, label: 'Excellent' },
  { min: 75, label: 'Strong' },
  { min: 60, label: 'Moderate' },
  { min: 40, label: 'Weak' },
  { min: 0, label: 'Critical' },
]

export function gradeFor(score: number): GradeLabel {
  const clamped = Math.max(0, Math.min(100, score))
  for (const band of GRADE_BANDS) {
    if (clamped >= band.min) return band.label
  }
  return 'Critical'
}

/** Round to one decimal place. Used everywhere a score or share is emitted. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Clamp into [0, max] then round to 1dp. */
export function clampScore(n: number, max: number): number {
  if (!Number.isFinite(n)) return 0
  return round1(Math.max(0, Math.min(max, n)))
}
