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

// ── Multi-engine scorecard (report top section) ─────────────────────────
//
// EngineSummary/deriveEngineSummaries supersedes the old EnginePresence/
// aggregateEnginePresence (Phase 2) — same pure-counting philosophy, but
// covers a full engine failure too. The old function only ever produced a
// row for an engine with at least one SUCCESSFUL answer, so an engine that
// failed on every single query silently vanished from the UI instead of
// showing an "unavailable" state (Task 21/22's explicit requirement). This
// tracks `attemptedCount` — every (query, engine) pair this engine was
// asked, success or failure — separately from `answeredCount`, so a fully
// failed engine still gets a row with `available: false`.
//
// Every field here is either a straight count/sum/mean over already-
// returned EngineAnswer data, or a formula ALREADY used server-side at the
// overall level (citationCoveragePercent mirrors the exact ratio
// lib/grader/scoring.ts's citation-authority category computes, just
// grouped per engine instead of across all engines combined). None of this
// is a new scoring model — there is deliberately no per-engine "score out
// of 100" anywhere here, because the backend does not compute one (Task 6
// of the multi-engine scorecard brief: prefer honest factual metrics over
// an invented composite score).

export interface EngineSummary {
  engine: GraderEngine
  /** Every (query, engine) pair attempted, success or failure. */
  attemptedCount: number
  /** Pairs that returned a usable answer. */
  answeredCount: number
  mentionedCount: number
  /** 0–100, mentionedCount/answeredCount — the multi-engine ring's fill. 0 when unavailable. */
  mentionRate: number
  label: PresenceLabel
  /** True once at least one answer succeeded — false renders the "unavailable" state. */
  available: boolean
  /** Mean of the non-null brandPosition values across this engine's answers; null if never cited. */
  avgPosition: number | null
  /** % of this engine's answered queries that carried ≥1 citation; null if unavailable. */
  citationCoveragePercent: number | null
  /** Distinct competitor names this engine named anywhere. */
  uniqueCompetitors: number
  /** Distinct domains this engine cited anywhere. */
  uniqueCitationDomains: number
}

const ENGINE_ORDER: GraderEngine[] = ['chatgpt', 'perplexity', 'claude']

/**
 * One row per engine that was actually queried in this report (Task 3: no
 * unsupported/unattempted engine ever appears), in the fixed
 * chatgpt/perplexity/claude order regardless of data order, so the UI is
 * stable across reports.
 */
export function deriveEngineSummaries(queries: QueryAnalysisResult[]): EngineSummary[] {
  interface Acc {
    attempted: number
    answered: number
    mentioned: number
    positions: number[]
    withCitation: number
    competitors: Set<string>
    citationDomains: Set<string>
  }
  const acc = new Map<GraderEngine, Acc>()
  const empty = (): Acc => ({
    attempted: 0,
    answered: 0,
    mentioned: 0,
    positions: [],
    withCitation: 0,
    competitors: new Set(),
    citationDomains: new Set(),
  })

  for (const query of queries) {
    for (const answer of query.per) {
      const entry = acc.get(answer.engine) ?? empty()
      entry.attempted += 1
      if (answer.error === null) {
        entry.answered += 1
        if (answer.brandMentioned) entry.mentioned += 1
        if (answer.brandPosition !== null) entry.positions.push(answer.brandPosition)
        if (answer.citations.length > 0) entry.withCitation += 1
        for (const c of answer.competitors) entry.competitors.add(normalizeCompetitorKey(c))
        for (const c of answer.citations) entry.citationDomains.add(c.domain)
      }
      acc.set(answer.engine, entry)
    }
  }

  return ENGINE_ORDER.filter((engine) => acc.has(engine)).map((engine) => {
    const a = acc.get(engine)!
    const available = a.answered > 0
    const mentionRate = available ? (a.mentioned / a.answered) * 100 : 0
    return {
      engine,
      attemptedCount: a.attempted,
      answeredCount: a.answered,
      mentionedCount: a.mentioned,
      mentionRate: round1(mentionRate),
      label: presenceLabel(a.mentioned, a.answered),
      available,
      avgPosition: a.positions.length > 0 ? round1(a.positions.reduce((s, p) => s + p, 0) / a.positions.length) : null,
      citationCoveragePercent: available ? round1((a.withCitation / a.answered) * 100) : null,
      uniqueCompetitors: a.competitors.size,
      uniqueCitationDomains: a.citationDomains.size,
    }
  })
}

function normalizeCompetitorKey(name: string): string {
  return name.trim().toLowerCase()
}

/** Round to one decimal place — mirrors lib/grader/grade.ts's round1 without importing a server-only module. */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Short, static descriptive tagline per engine — copy only, never data-driven. */
const ENGINE_TAGLINES: Record<GraderEngine, string> = {
  chatgpt: 'AI Answer Visibility',
  perplexity: 'Real-Time AI Answers',
  claude: 'Conversational AI Visibility',
}

export function engineTagline(engine: GraderEngine): string {
  return ENGINE_TAGLINES[engine]
}

/**
 * One deterministic, data-driven sentence per engine card (Task 9). No LLM
 * call, no new copy generation — a fixed template selected by `label`/
 * `available`, with the one real number (competitor count) it can safely
 * cite inline.
 */
export function engineInterpretation(summary: EngineSummary): string {
  if (!summary.available) {
    return "We couldn't retrieve enough verified data from this engine during this analysis."
  }
  switch (summary.label) {
    case 'Strong':
      return "Your brand appears consistently across this engine's analyzed prompts."
    case 'Moderate':
      return summary.uniqueCompetitors > 0
        ? `You have some visibility here, but ${summary.uniqueCompetitors} other brand${summary.uniqueCompetitors === 1 ? '' : 's'} also surface regularly across these prompts.`
        : 'You have some visibility here, with room to appear more consistently across these prompts.'
    case 'Weak':
      return summary.uniqueCompetitors > 0
        ? `Your brand is rarely surfaced by this engine — ${summary.uniqueCompetitors} other brand${summary.uniqueCompetitors === 1 ? '' : 's'} appear more often across the analyzed prompts.`
        : 'Your brand is rarely surfaced by this engine in the analyzed prompts.'
    case 'Not Mentioned':
      return 'This engine did not surface your brand in any analyzed prompt.'
  }
}

/**
 * One short, comparative headline across every engine (the "quick overall
 * interpretation" that sits directly under the scorecard's heading) — a
 * plain min/max comparison over `mentionRate`, nothing more. Falls back to
 * a neutral line when there's nothing meaningful to compare (0 or 1
 * available engine, or every available engine tied).
 */
export function engineComparisonSummary(summaries: EngineSummary[]): string {
  const available = summaries.filter((s) => s.available)
  if (available.length < 2) {
    return 'How your brand performs across the AI answer engines analyzed.'
  }
  const sorted = [...available].sort((a, b) => b.mentionRate - a.mentionRate)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  if (best.mentionRate === worst.mentionRate) {
    return 'Your brand shows a similar level of visibility across every AI engine analyzed.'
  }
  return `Your brand performs best on ${engineLabel(best.engine)} and has the most room to grow on ${engineLabel(worst.engine)}.`
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
