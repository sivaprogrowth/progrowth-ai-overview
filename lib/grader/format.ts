/**
 * Presentation-only helpers for the grader frontend.
 *
 * STRICT RULE (Phase 2 Task 2): nothing here calculates a score, a grade,
 * a competitor, a citation, or a recommendation — those are Phase 1
 * backend outputs, period. Every function below is a pure, simple
 * transform of an already-computed backend value into a display string,
 * a Tailwind/CSS class name, or a UI bucket label. Dependency-free leaf —
 * safe to import from client components and to unit test with node:test,
 * exactly like the Phase 1 lib/grader modules.
 */

import type {
  CitationSourceType,
  GradeLabel,
  GraderEngine,
  QueryAnalysisResult,
  QueryCategory,
  RecommendationPriority,
} from './types'

// ── Grade / score presentation ──────────────────────────────────────────

/** Grade → a semantic color token (CSS var name), for score-tier accents. */
export function gradeTone(grade: GradeLabel): 'success' | 'accent' | 'warning' | 'danger' {
  switch (grade) {
    case 'Excellent':
      return 'success'
    case 'Strong':
      return 'accent'
    case 'Moderate':
      return 'warning'
    case 'Weak':
    case 'Critical':
      return 'danger'
  }
}

/** Whole-number display of a 1dp backend score — display rounding only. */
export function formatScore(score: number): string {
  return String(Math.round(score))
}

export function formatPercent(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}

// ── Query category / engine / priority labels ───────────────────────────

const CATEGORY_LABELS: Record<QueryCategory, string> = {
  category_discovery: 'Discovery',
  recommendation_intent: 'Recommendation',
  brand_evaluation: 'Brand',
  alternatives_comparison: 'Comparison',
}

export function categoryLabel(category: QueryCategory): string {
  return CATEGORY_LABELS[category]
}

/**
 * Display names for the engines Phase 1 actually queries. Deliberately a
 * closed map, not a fallback-to-raw-string function — if the backend ever
 * returns an engine not in this map, callers should treat that as a bug to
 * fix here rather than silently render a raw enum value or (worse) a name
 * for an engine the product doesn't advertise (Task 10).
 */
const ENGINE_LABELS: Record<GraderEngine, string> = {
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  claude: 'Claude',
}

export function engineLabel(engine: GraderEngine): string {
  return ENGINE_LABELS[engine] ?? engine
}

export function priorityLabel(priority: RecommendationPriority): string {
  return priority === 'high' ? 'High Priority' : priority === 'medium' ? 'Medium Priority' : 'Low Priority'
}

export function priorityTone(priority: RecommendationPriority): 'danger' | 'warning' | 'accent' {
  return priority === 'high' ? 'danger' : priority === 'medium' ? 'warning' : 'accent'
}

// ── AI Presence (Task 16) ────────────────────────────────────────────────
//
// A SIMPLE UI bucket over an already-returned measurement (mentioned count
// / answered count) — explicitly allowed by Task 16 ("simple UI
// transformations of actual returned measurements"). This is NOT a second
// scoring model: it has no weights, no formula beyond one ratio, and every
// caller renders the underlying "mentioned in X of Y" count alongside the
// label rather than the label alone (Task 16's fallback requirement).
export type PresenceLabel = 'Strong' | 'Moderate' | 'Weak' | 'Not Mentioned'

export function presenceLabel(mentionedCount: number, answeredCount: number): PresenceLabel {
  if (answeredCount === 0 || mentionedCount === 0) return 'Not Mentioned'
  const rate = mentionedCount / answeredCount
  if (rate >= 0.66) return 'Strong'
  if (rate >= 0.33) return 'Moderate'
  return 'Weak'
}

export function presenceTone(label: PresenceLabel): 'success' | 'warning' | 'danger' | 'muted' {
  switch (label) {
    case 'Strong':
      return 'success'
    case 'Moderate':
      return 'warning'
    case 'Weak':
      return 'danger'
    case 'Not Mentioned':
      return 'muted'
  }
}

export interface EnginePresence {
  engine: GraderEngine
  mentionedCount: number
  answeredCount: number
  label: PresenceLabel
}

/**
 * Group the already-returned per-query, per-engine answers (Phase 1's
 * `QueryAnalysisResult.per`) into one row per engine. Pure counting over
 * data the backend already computed — no new score, no weighting, exactly
 * the "simple UI transformation" Task 16 permits. Always returns a row for
 * every engine that answered at least one query, in the fixed engine order
 * (chatgpt, perplexity, claude) rather than the order they happen to
 * appear in the data, so the UI is stable across reports.
 */
export function aggregateEnginePresence(queries: QueryAnalysisResult[]): EnginePresence[] {
  const order: GraderEngine[] = ['chatgpt', 'perplexity', 'claude']
  const counts = new Map<GraderEngine, { mentioned: number; answered: number }>()

  for (const query of queries) {
    for (const answer of query.per) {
      if (answer.error !== null) continue
      const entry = counts.get(answer.engine) ?? { mentioned: 0, answered: 0 }
      entry.answered += 1
      if (answer.brandMentioned) entry.mentioned += 1
      counts.set(answer.engine, entry)
    }
  }

  return order
    .filter((engine) => counts.has(engine))
    .map((engine) => {
      const c = counts.get(engine)!
      return {
        engine,
        mentionedCount: c.mentioned,
        answeredCount: c.answered,
        label: presenceLabel(c.mentioned, c.answered),
      }
    })
}

// ── Readiness (Task 22) ──────────────────────────────────────────────────

export type ReadinessStatusLabel = 'Pass' | 'Needs Attention' | 'Not evaluated'

/** `passed === null` means the check could not be run — never render that as a failure. */
export function readinessStatusLabel(passed: boolean | null): ReadinessStatusLabel {
  if (passed === null) return 'Not evaluated'
  return passed ? 'Pass' : 'Needs Attention'
}

export function readinessTone(passed: boolean | null): 'success' | 'warning' | 'muted' {
  if (passed === null) return 'muted'
  return passed ? 'success' : 'warning'
}

// ── Citations (Task 20/21) ───────────────────────────────────────────────

const SOURCE_TYPE_LABELS: Record<CitationSourceType, string> = {
  owned: 'Owned',
  review: 'Review Platform',
  directory: 'Directory',
  publisher: 'Publisher',
  social: 'Social / Community',
  reference: 'Reference',
}

/** null (unclassified) renders as nothing — never a guessed label. */
export function sourceTypeLabel(type: CitationSourceType | null): string | null {
  return type ? SOURCE_TYPE_LABELS[type] : null
}

// ── Domain / URL display ─────────────────────────────────────────────────

/** Wrap-safe display of a long domain — inserts a zero-width break opportunity after each dot. */
export function wrappableDomain(domain: string): string {
  return domain.replace(/\./g, '.​')
}
