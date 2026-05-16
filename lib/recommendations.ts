/**
 * Recommendation engine + Google AI principles single-source-of-truth
 * (Task 26.7; also feeds the Task 26.9 debunked-tactics copy guardrail).
 *
 * Google's official position (Search Central, "AI features and your website"):
 * eligibility for AI Overviews / AI Mode is *exactly* standard Google Search
 * eligibility — there is no AI-specific markup, no llms.txt, no "AI rewrite",
 * no content-chunking requirement, and structured data is NOT an AI-ranking
 * lever. This module therefore only ever prescribes what Google actually
 * documents, in Google's own priority order:
 *
 *   1. Crawl/index access (Search Essentials)         — the hard gate
 *   2. Helpful, people-first content + E-E-A-T        — the substance
 *   3. Page experience / Core Web Vitals              — a ranking signal
 *   4. Channel surfaces: Business Profile / Merchant  — vertical-specific
 *
 * `buildRecommendations` is a pure function — no I/O, deterministic, fully
 * unit-testable. Callers (app/api/scorecard/route.ts in 26.8) fetch the
 * cards + readiness snapshot and pass them in.
 */

import type { KPICard, AiReadinessSnapshot } from './scorecard'

// ── Google AI principles (single source of truth, with doc URLs) ───────────

export interface GooglePrinciple {
  id: string
  title: string
  summary: string
  docUrl: string
}

export const GOOGLE_AI_PRINCIPLES = {
  searchEligibility: {
    id: 'searchEligibility',
    title: 'AI features eligibility = Search eligibility',
    summary:
      'Pages eligible to appear in AI Overviews and AI Mode are exactly those eligible for Google Search. There is no separate AI submission, markup, or format. Fix Search eligibility and AI eligibility follows.',
    docUrl: 'https://developers.google.com/search/docs/appearance/ai-features',
  },
  crawlAccess: {
    id: 'crawlAccess',
    title: 'Crawl & index access (Search Essentials)',
    summary:
      'Googlebot must be able to fetch (HTTP 2xx, not blocked in robots.txt) and index (no noindex, no snippet suppression) the page. Blocking Googlebot removes the page from Search AND AI Overviews. nosnippet / data-nosnippet / max-snippet:0 keep the page indexed but bar its content from AI surfaces.',
    docUrl: 'https://developers.google.com/search/docs/essentials',
  },
  helpfulContent: {
    id: 'helpfulContent',
    title: 'People-first, helpful content',
    summary:
      "Google's helpful-content self-assessment: does the content provide original information, insight, or analysis beyond the obvious? Would a user feel they had a satisfying experience? Is it created for people first, not to game ranking? Demonstrate first-hand expertise and substantive value.",
    docUrl: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
  },
  eeat: {
    id: 'eeat',
    title: 'Experience, Expertise, Authoritativeness, Trust (E-E-A-T)',
    summary:
      'Make authorship, first-hand experience, and the who/how/why behind the content clear. Trust is the most important member of the E-E-A-T family. This is how Google assesses quality across Search and AI surfaces.',
    docUrl: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content#eeat',
  },
  pageExperience: {
    id: 'pageExperience',
    title: 'Page experience & Core Web Vitals',
    summary:
      'Core Web Vitals (LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1), HTTPS, and mobile-friendliness are a ranking signal — they strengthen good content, they are not an eligibility gate and cannot rescue thin content.',
    docUrl: 'https://developers.google.com/search/docs/appearance/page-experience',
  },
  businessProfile: {
    id: 'businessProfile',
    title: 'Google Business Profile (local visibility)',
    summary:
      'For local/service-area businesses, a complete, verified Google Business Profile is the primary lever for local AI and map surfaces — distinct from website SEO.',
    docUrl: 'https://support.google.com/business/answer/3038177',
  },
  merchantCenter: {
    id: 'merchantCenter',
    title: 'Merchant Center & product structured data (ecommerce)',
    summary:
      'For ecommerce, accurate product data via Merchant Center plus valid Product structured data drives shopping/product AI surfaces. Structured data here enables a feature — it is not an AI-ranking trick.',
    docUrl: 'https://developers.google.com/search/docs/appearance/structured-data/product',
  },
} as const satisfies Record<string, GooglePrinciple>

export type GooglePrincipleId = keyof typeof GOOGLE_AI_PRINCIPLES

/**
 * Tactics Google has explicitly stated do NOT help AI visibility. The
 * recommendation engine must never emit these, and the 26.9 copy sweep
 * uses this list as its checklist. Keep this the single source of truth.
 *
 * GUARDRAIL — applies to ALL user-facing copy, prompts, and any future
 * generator (notably the multi-tenant Phase-2 `lib/promptGenerator.ts`):
 * no prompt, hint, recommendation, email, or UI string may instruct or
 * imply any tactic in this list. When building `promptGenerator.ts`,
 * import and call `instructsDebunkedTactic(promptText)` and reject any
 * generated prompt for which it returns true, before persisting.
 * Generated prompts must measure visibility for real buyer-intent
 * queries — never coach a site to "optimize for AI", add an llms.txt,
 * chunk content, rewrite in an "AI tone", or treat schema as an
 * AI-ranking requirement.
 */
export const DEBUNKED_TACTICS: Array<{
  id: string
  claim: string
  reality: string
}> = [
  {
    id: 'llms-txt',
    claim: 'Publish an llms.txt to control or improve LLM/AI visibility.',
    reality:
      'Google does not use llms.txt for AI Overviews / AI Mode. It is not a Google standard and confers no Search or AI eligibility.',
  },
  {
    id: 'ai-content-chunking',
    claim: 'Restructure pages into "AI-friendly chunks" so models can parse them.',
    reality:
      'Google crawls and renders pages the same for AI features as for Search. There is no separate chunking format that improves AI inclusion.',
  },
  {
    id: 'ai-specific-rewrite',
    claim: 'Rewrite content specifically for LLMs / in an "AI tone".',
    reality:
      'People-first helpful content is the only target. Writing for a model rather than the reader is the content-for-search-engines anti-pattern Google penalises.',
  },
  {
    id: 'schema-as-ai-requirement',
    claim: 'Adding schema/structured data is required for, or boosts, AI Overview inclusion.',
    reality:
      'Structured data enables specific rich/feature eligibility; it is not a requirement for, nor a ranking lever in, AI Overviews / AI Mode.',
  },
  {
    id: 'keyword-stuffing-for-llms',
    claim: 'Pack pages with entities/keywords so LLMs "understand" the brand.',
    reality:
      'This is classic keyword stuffing — a spam signal under Search Essentials, not an AI-visibility technique.',
  },
]

/**
 * Raw matcher for debunked-tactic phrasing. Matches the *prescriptive*
 * shape ("add an llms.txt", "chunk content for AI", "rewrite for an AI
 * tone", "schema required for AI") — NOT neutral mentions, so the
 * legitimate keyword-batch `CHUNK_SIZE` code never false-positives.
 *
 * It does NOT distinguish instruction from prohibition: this module's own
 * corrective copy ("do NOT rewrite for an AI tone") matches too. For
 * ENFORCEMENT use `instructsDebunkedTactic()` below, which is negation-aware.
 */
export function debunkedTacticPattern(): RegExp {
  return new RegExp(
    [
      'llms?\\.txt',
      '(chunk|chunking)\\s+(content|pages?|text)\\s+for\\s+(ai|llms?)',
      '(rewrite|rewriting|optimi[sz]e|optimizing|write|writing)\\s+(content|copy|pages?|text)?\\s*(for|in an?)\\s*(ai|llm|chatgpt|perplexity)(\\s|-)?(tone|voice|rewrite)?',
      'ai[- ]?(tone|voice)',
      '(schema|structured data)\\s+(is\\s+)?(required|requirement|needed|necessary)\\s+for\\s+(ai|llm|ai overview)',
      '(entity|keyword)\\s+stuffing\\s+for\\s+(ai|llms?)',
    ].join('|'),
    'ig'
  )
}

/**
 * Negation-aware enforcement predicate. Returns true only when copy
 * *instructs* a debunked tactic — an occurrence NOT preceded by a
 * prohibition ("do not", "never", "don't", "avoid", "not a", "no ").
 * This is what the Phase-2 `lib/promptGenerator.ts` MUST call before
 * persisting a generated prompt:
 *
 *   import { instructsDebunkedTactic } from '@/lib/recommendations'
 *   if (instructsDebunkedTactic(promptText)) throw new Error('debunked tactic')
 *
 * Prohibitive guidance (this module's own "do NOT rewrite for an AI tone")
 * correctly returns false.
 */
export function instructsDebunkedTactic(text: string): boolean {
  const re = debunkedTacticPattern()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // A prohibition token anywhere in the ~60 chars before the match means
    // this is corrective ("do NOT rewrite for an AI tone", "never add an
    // llms.txt"), not an instruction. Window-presence (not positional) so
    // multi-word gaps between the negation and the tactic still count.
    const ctx = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase()
    if (!/\b(do not|don'?t|never|avoid|without|not\b|isn'?t|no longer)\b/.test(ctx)) {
      return true
    }
  }
  return false
}

// ── Recommendation model ───────────────────────────────────────────────────

export type RecommendationSeverity = 'critical' | 'high' | 'medium' | 'low'

const SEVERITY_RANK: Record<RecommendationSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export interface Recommendation {
  id: string
  severity: RecommendationSeverity
  /** Which Google principle this action is grounded in. */
  googlePrinciple: GooglePrincipleId
  /** What we observed that triggered this (the evidence). */
  finding: string
  /** The concrete, Google-aligned action to take. */
  action: string
  /** Authoritative Google doc backing the action. */
  docUrl: string
  /** KPI card that surfaced the issue, when applicable. */
  kpiId?: KPICard['id']
}

export interface BuildRecommendationsOptions {
  /**
   * Flattened vertical hints (cluster names / ids / sample prompt words).
   * Enables the local / ecommerce channel recommendations. Optional — the
   * core gate/content/CWV logic works without it.
   */
  verticals?: string[]
}

function principleRef(id: GooglePrincipleId): { googlePrinciple: GooglePrincipleId; docUrl: string } {
  return { googlePrinciple: id, docUrl: GOOGLE_AI_PRINCIPLES[id].docUrl }
}

function findCard(cards: KPICard[], id: KPICard['id']): KPICard | undefined {
  return cards.find((c) => c.id === id)
}

/**
 * Pure recommendation builder. Emits an impact-ordered list grounded in
 * Google's documented hierarchy. Never emits a DEBUNKED_TACTICS item.
 */
export function buildRecommendations(
  cards: KPICard[],
  readiness: AiReadinessSnapshot | null,
  opts: BuildRecommendationsOptions = {}
): Recommendation[] {
  const recs: Recommendation[] = []

  // ── 1. HARD GATE (critical) — crawl/index access first ──────────────────
  // Per Google: AI eligibility requires Search eligibility. Nothing else
  // matters until the page can be crawled, indexed, and snippet-shown.
  if (readiness && !readiness.searchEligible) {
    if (readiness.blockedCriticalBots.length > 0) {
      recs.push({
        id: 'gate-bots-blocked',
        severity: 'critical',
        ...principleRef('crawlAccess'),
        finding: `robots.txt blocks answer-engine crawler(s): ${readiness.blockedCriticalBots.join(', ')}. These power measured AI engines (Google AI Overviews / ChatGPT Search / Perplexity / Claude).`,
        action:
          'Remove the Disallow rules for these user-agents in robots.txt. AI eligibility requires Search eligibility — a blocked critical crawler removes the site from those answer surfaces entirely.',
        kpiId: 6,
      })
    }
    const failures = readiness.topFailures.join(' | ').toLowerCase()
    if (failures.includes('noindex')) {
      recs.push({
        id: 'gate-noindex',
        severity: 'critical',
        ...principleRef('crawlAccess'),
        finding: 'One or more audited pages carry a `noindex` directive — excluded from Google Search and every AI answer engine.',
        action:
          'Remove the `noindex` from pages that should be discoverable (check the robots meta tag and the X-Robots-Tag response header).',
        kpiId: 6,
      })
    }
    if (failures.includes('snippet')) {
      recs.push({
        id: 'gate-snippet-suppressed',
        severity: 'critical',
        ...principleRef('crawlAccess'),
        finding: 'Snippet suppression detected (`nosnippet` / `data-nosnippet` / `max-snippet:0`). The page stays indexed but its content cannot appear in AI Overviews or AI Mode.',
        action:
          'Remove nosnippet / data-nosnippet attributes and any `max-snippet:0` directive on pages whose content should be eligible for AI surfaces.',
        kpiId: 6,
      })
    }
    if (failures.includes('http') && !failures.includes('noindex') && !failures.includes('snippet')) {
      recs.push({
        id: 'gate-non-200',
        severity: 'critical',
        ...principleRef('crawlAccess'),
        finding: 'One or more audited pages do not return HTTP 2xx — they cannot be indexed or surfaced anywhere.',
        action: 'Fix the non-2xx responses (resolve 4xx/5xx, ensure final URLs return 200) before any content work.',
        kpiId: 6,
      })
    }
    // Fallback when not eligible but no specific signal was decomposable.
    if (recs.length === 0) {
      recs.push({
        id: 'gate-not-eligible',
        severity: 'critical',
        ...principleRef('searchEligibility'),
        finding: 'The AI-readiness audit reports the page is not Search-eligible.',
        action:
          'Resolve crawl/index access (robots.txt, HTTP status, noindex, snippet directives) first — AI Overviews / AI Mode eligibility is exactly Search eligibility.',
        kpiId: 6,
      })
    }
  }

  const gateClear = !readiness || readiness.searchEligible

  // ── 2. CONTENT & E-E-A-T (high) — only meaningful once the gate is clear ─
  // Indexed and (often) ranking on Google, but weak AI citation share / a
  // wide GEO↔SEO gap ⇒ the gap is content substance, not technical access.
  if (gateClear) {
    const kpi3 = findCard(cards, 3) // Citation Share %
    const kpi5 = findCard(cards, 5) // GEO/SEO Gap %

    const citationWeak =
      kpi3 &&
      kpi3.current !== null &&
      typeof kpi3.target30d === 'number' &&
      kpi3.current < kpi3.target30d

    const gapWide =
      kpi5 &&
      kpi5.current !== null &&
      kpi5.current >= 50 // ≥50% of SEO-ranked sources don't translate to AI citations

    if (citationWeak || gapWide) {
      const evidence = [
        citationWeak ? `citation share ${kpi3!.current}${kpi3!.unit.includes('%') ? '%' : ''} is below the 30-day target (${kpi3!.target30d})` : null,
        gapWide ? `GEO/SEO gap is ${kpi5!.current}% — Google-ranked sources are largely not the ones AI engines cite` : null,
      ]
        .filter(Boolean)
        .join('; ')

      recs.push({
        id: 'content-helpful-eeat',
        severity: 'high',
        ...principleRef('helpfulContent'),
        finding: `Technically eligible but under-cited by AI engines (${evidence}). When pages are indexable yet not cited, the lever is content substance, not technical SEO.`,
        action:
          "Apply Google's helpful-content self-assessment to the target pages: add original research/data, first-hand experience, and insight beyond the obvious; make who/how/why and authorship explicit; answer the question more completely and trustworthily than the currently-cited sources. Do NOT rewrite for an 'AI tone' or chunk content — write people-first.",
        kpiId: kpi3?.id ?? 5,
      })

      recs.push({
        id: 'content-eeat-trust',
        severity: 'high',
        ...principleRef('eeat'),
        finding: 'AI engines preferentially cite sources with clear expertise and trust signals.',
        action:
          'Strengthen E-E-A-T on the under-cited pages: visible author with credentials and first-hand experience, citations to primary sources, clear publication/update dates, and an about/methodology reference. Trust is the dominant E-E-A-T factor.',
        kpiId: kpi3?.id ?? 5,
      })
    }
  }

  // ── 3. PAGE EXPERIENCE (medium) — a ranking signal, never a gate ────────
  // Only when measured AND failing. Never recommend on unknown metrics.
  if (gateClear && readiness?.pageExperience && readiness.pageExperience.allCoreWebVitalsPass === false) {
    const pe = readiness.pageExperience
    const detail: string[] = []
    if (pe.avgLcpMs !== null && pe.avgLcpMs > 2500) detail.push(`LCP ~${Math.round(pe.avgLcpMs)}ms (>2500)`)
    if (pe.avgCls !== null && pe.avgCls > 0.1) detail.push(`CLS ~${pe.avgCls} (>0.1)`)
    if (pe.avgTbtMs !== null && pe.avgTbtMs > 200) detail.push(`TBT ~${Math.round(pe.avgTbtMs)}ms (INP proxy >200)`)
    if (detail.length > 0) {
      recs.push({
        id: 'page-experience-cwv',
        severity: 'medium',
        ...principleRef('pageExperience'),
        finding: `Core Web Vitals outside Google "good" thresholds: ${detail.join(', ')}.`,
        action:
          'Address the failing Core Web Vitals (image/LCP optimisation, layout-shift reservations, main-thread/JS reduction). This strengthens already-helpful content; it will not compensate for thin content.',
        kpiId: 6,
      })
    }
  }

  // ── 4. VERTICAL CHANNELS (medium/low) — Business Profile / Merchant ─────
  const v = (opts.verticals ?? []).join(' ').toLowerCase()
  if (gateClear && v) {
    const isLocal = /\b(local|near me|service area|clinic|dealership|restaurant|law firm|dental|hvac|plumb|roofing|contractor)\b/.test(v)
    const isEcom = /\b(ecommerce|e-commerce|shop|store|product|retail|cart|checkout|merchant|catalog)\b/.test(v)
    if (isLocal) {
      recs.push({
        id: 'channel-business-profile',
        severity: 'medium',
        ...principleRef('businessProfile'),
        finding: 'Vertical signals indicate a local/service business; local AI and map surfaces are driven by Google Business Profile, separate from website SEO.',
        action: 'Ensure a complete, verified Google Business Profile (categories, hours, services, photos, reviews) — the primary lever for local AI/maps visibility.',
      })
    }
    if (isEcom) {
      recs.push({
        id: 'channel-merchant-center',
        severity: 'medium',
        ...principleRef('merchantCenter'),
        finding: 'Vertical signals indicate ecommerce; shopping/product AI surfaces are driven by Merchant Center + valid Product structured data.',
        action: 'Maintain accurate Merchant Center product data and valid Product structured data so products are eligible for shopping/product AI surfaces (a feature gate, not a ranking trick).',
      })
    }
  }

  // ── 5. ALL CLEAR — affirm + steer to the durable lever ──────────────────
  if (gateClear && recs.length === 0) {
    recs.push({
      id: 'maintain-helpful-content',
      severity: 'low',
      ...principleRef('helpfulContent'),
      finding: 'No technical eligibility or measured page-experience blockers detected.',
      action:
        'Maintain the lead with continued people-first, experience-led content and E-E-A-T. The durable AI-visibility lever is substance, not any AI-specific format.',
    })
  }

  return recs.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}
