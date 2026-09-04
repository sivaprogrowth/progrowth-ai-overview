/**
 * ProGrowth AI Grader — the whole pipeline's domain model.
 *
 * Dependency-free leaf: types only, no runtime imports. Every stage of the
 * grader speaks these shapes, so nothing downstream of
 * lib/grader/dataforseo.ts ever sees a raw DataForSEO response.
 *
 * The grader is a SEPARATE product surface from the internal AI Overview
 * tool. It shares infrastructure (lib/dataforseo, lib/supabase,
 * lib/aiReadiness) but never the internal `clients` / `analyses` schema.
 */

// ── Input ──────────────────────────────────────────────────────────────────

export interface GraderInput {
  domain: string
  companyName: string
  industry: string
  /** Optional but strongly preferred — sharpens category/discovery queries. */
  service?: string
  /** Optional but strongly preferred — e.g. "Texas", "United States". */
  location?: string
}

export interface NormalizedGraderInput {
  /** Bare registrable host, lowercased, no protocol/www/path. */
  domain: string
  companyName: string
  industry: string
  service: string | null
  location: string | null
  /** `https://<domain>` — the only URL the readiness checks are allowed to hit. */
  homepageUrl: string
}

export interface NormalizationIssue {
  field: keyof GraderInput | 'input'
  message: string
}

export type NormalizeResult =
  | { ok: true; value: NormalizedGraderInput }
  | { ok: false; issues: NormalizationIssue[] }

// ── Queries ────────────────────────────────────────────────────────────────

export type QueryCategory =
  | 'category_discovery'
  | 'recommendation_intent'
  | 'brand_evaluation'
  | 'alternatives_comparison'

export type QueryPriority = 'high' | 'medium' | 'low'

export interface GeneratedQuery {
  query: string
  category: QueryCategory
  priority: QueryPriority
  /** 'template' = deterministic; 'llm' = the optional single enrichment call. */
  source: 'template' | 'llm'
}

// ── Engine answers ─────────────────────────────────────────────────────────

/** The answer engines the grader can query on this DataForSEO account tier. */
export type GraderEngine = 'chatgpt' | 'perplexity' | 'claude'

export interface CitationRef {
  domain: string
  url: string
  title: string | null
}

/** One (query, engine) pair, normalised out of the raw provider response. */
export interface EngineAnswer {
  query: string
  engine: GraderEngine
  /** Visible answer body. Empty string when the call failed. */
  answerText: string
  brandMentioned: boolean
  /**
   * 1-based rank of the brand among the DISTINCT cited domains of this
   * answer, or null when the brand is named in the body but not cited
   * (or not present at all).
   */
  brandPosition: number | null
  /** Distinct competitor brand names named in the answer body. */
  competitors: string[]
  citations: CitationRef[]
  /** DataForSEO's reported cost for this call, when the envelope carries one. */
  costUsd: number | null
  /** Provider/transport failure for this pair; null on success. */
  error: string | null
}

/** Per-query rollup across every engine that answered it. */
export interface QueryAnalysisResult {
  query: string
  category: QueryCategory
  priority: QueryPriority
  /** True if ANY engine mentioned or cited the brand. */
  brandMentioned: boolean
  /** Best (lowest) brandPosition across engines; null when never cited. */
  brandPosition: number | null
  /** Engines that mentioned the brand. */
  enginesMentioning: GraderEngine[]
  /** Engines that returned a usable answer (denominator for coverage). */
  enginesAnswered: GraderEngine[]
  /** Short excerpt around the brand mention, or the answer head. */
  answerText: string
  competitors: string[]
  citations: CitationRef[]
  sentiment: SentimentLabel
  per: EngineAnswer[]
}

// ── Competitors ────────────────────────────────────────────────────────────

export interface CompetitorResult {
  name: string
  /** Total appearances across all (query, engine) answers. */
  mentions: number
  /** Distinct queries in which this competitor appeared. */
  queriesPresent: number
  /** mentions / (all brand+competitor mentions) * 100, 1dp. */
  shareOfVoice: number
}

// ── Citations ──────────────────────────────────────────────────────────────

/**
 * Source class, only when it is reliably identifiable from a curated
 * domain list. `null` means "not confidently classifiable" — the grader
 * never guesses a type it cannot defend.
 */
export type CitationSourceType =
  | 'owned'
  | 'review'
  | 'directory'
  | 'publisher'
  | 'social'
  | 'reference'

export interface CitationResult {
  domain: string
  /** Times this domain was cited across all analysed answers. */
  mentions: number
  /** % of analysed answers that cited it, 1dp. */
  coverage: number
  /** True when the domain is the graded brand's own (or a subdomain). */
  owned: boolean
  sourceType: CitationSourceType | null
}

export interface CitationSummary {
  domains: CitationResult[]
  uniqueDomains: number
  totalCitations: number
  /** % of all citations that point at the brand's own domain, 1dp. */
  ownedShare: number
  /** 100 - ownedShare, 1dp. */
  thirdPartyShare: number
  /** Distinct third-party domains that cited the brand's market. */
  thirdPartyDomains: number
}

// ── Sentiment ──────────────────────────────────────────────────────────────

export type SentimentLabel = 'positive' | 'neutral' | 'negative' | 'mixed' | 'unknown'

export interface SentimentAssessment {
  sentiment: SentimentLabel
  /** 0–1. 0 whenever the label is 'unknown'. */
  confidence: number
}

export interface SentimentSummary extends SentimentAssessment {
  /** Answers in which the brand was actually named (the only ones scored). */
  analyzed: number
  byLabel: Record<SentimentLabel, number>
  /** Set when the layer could not run at all; the report stays usable. */
  error: string | null
}

// ── AI readiness ───────────────────────────────────────────────────────────

export interface ReadinessCheck {
  id: string
  label: string
  /** null = could not be determined (never counted against the score). */
  passed: boolean | null
  detail: string
}

export interface ReadinessResult {
  status: 'ok' | 'partial' | 'unavailable'
  checks: ReadinessCheck[]
  /** Checks that returned a definite true. */
  passedCount: number
  /** Checks that returned a definite true or false (the score denominator). */
  evaluatedCount: number
  error: string | null
}

// ── Scoring ────────────────────────────────────────────────────────────────

export type ScoreCategoryId =
  | 'visibility'
  | 'citation'
  | 'sentiment'
  | 'competitive'
  | 'coverage'
  | 'readiness'

export interface ScoreCategory {
  id: ScoreCategoryId
  label: string
  /** Points awarded, rounded to 1dp. */
  score: number
  /** Maximum points for this category. */
  max: number
  /** The exact inputs that produced `score` — makes the number auditable. */
  detail: string
}

export type GradeLabel = 'Excellent' | 'Strong' | 'Moderate' | 'Weak' | 'Critical'

export interface ScoreBreakdown {
  overall: number
  grade: GradeLabel
  categories: ScoreCategory[]
  /** Convenience mirrors of the category scores, for the DB columns. */
  visibility: number
  citation: number
  sentiment: number
  competitive: number
  coverage: number
  readiness: number
}

// ── Recommendations ────────────────────────────────────────────────────────

export type RecommendationPriority = 'high' | 'medium' | 'low'

export type RecommendationCategory =
  | 'visibility'
  | 'citations'
  | 'competitive'
  | 'coverage'
  | 'readiness'
  | 'sentiment'

export interface Recommendation {
  id: string
  priority: RecommendationPriority
  category: RecommendationCategory
  title: string
  /** The observed evidence that triggered this rule. */
  reason: string
  /** The concrete action to take. */
  action: string
  /** Authoritative Google doc backing the action, when one applies. */
  docUrl?: string
}

// ── Usage / cost ───────────────────────────────────────────────────────────

export interface UsageStats {
  dataforseoRequests: number
  llmCalls: number
  /** null when the provider reported no cost for any call. */
  estimatedCostUsd: number | null
  durationMs: number
}

// ── Report ─────────────────────────────────────────────────────────────────

export type GraderRunStatus = 'processing' | 'completed' | 'partial' | 'failed'

export interface GraderReportCompany {
  companyName: string
  domain: string
  industry: string
  service: string | null
  location: string | null
}

export interface GraderReport {
  company: GraderReportCompany
  score: ScoreBreakdown
  queries: QueryAnalysisResult[]
  competitors: CompetitorResult[]
  citations: CitationSummary
  sentiment: SentimentSummary
  readiness: ReadinessResult
  recommendations: Recommendation[]
  summary: string
  usage: UsageStats
  /** Non-fatal stage failures, e.g. "readiness: homepage unreachable". */
  warnings: string[]
}

export interface GraderRun {
  reportId: string
  status: GraderRunStatus
  report: GraderReport | null
  /** Sanitised, user-safe message. Never a stack trace or credential. */
  error: string | null
  createdAt: string
  completedAt: string | null
}
