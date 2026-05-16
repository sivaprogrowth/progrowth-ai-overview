/**
 * KPI 6 — AI-Readiness technical audit (Task 26.3).
 *
 * Encodes Google's official AI-features guidance: eligibility for AI Overviews
 * and AI Mode is *exactly* standard Google Search snippet eligibility — there
 * is no AI-specific markup, llms.txt, or chunking requirement. So this module
 * audits only the real, automatable gates:
 *
 *   1. auditRobots(domain)        — free robots.txt fetch + per-bot rule parse
 *   2. auditIndexability(url)     — DataForSEO on_page/instant_pages + a free
 *                                   direct fetch for exact noindex/nosnippet
 *                                   directives (the silent AI-visibility killer)
 *   3. auditPageExperience(url)   — DataForSEO on_page/lighthouse, mapped to
 *                                   Google's Core Web Vitals thresholds
 *
 * **Critical robots.txt nuance (from the docs, must not be misreported):**
 *   - Blocking `Googlebot` removes the site from Google Search AND Google
 *     AI Overviews / AI Mode — hard fail.
 *   - Blocking `Google-Extended` ONLY affects Gemini app / Vertex grounding
 *     and model training. It does NOT affect Google Search, AI Overviews, or
 *     AI Mode. Reported as informational, never as a Google AI failure.
 *   - Blocking `OAI-SearchBot` / `PerplexityBot` / `ClaudeBot` removes the
 *     answer engines this tool actually measures — hard fail.
 *
 * Cost: auditRobots is free. auditIndexability is ~$0.0006/page and
 * auditPageExperience ~$0.004/page, both already cap-guarded inside
 * lib/dataforseo.ts (throw DataForSeoCapExceededError when the daily cap is
 * hit). This module never swallows that error — callers (26.4 cron) decide.
 */

import {
  fetchOnPageInstant,
  fetchOnPageLighthouse,
  type OnPageInstantResult,
  type OnPageLighthouseResult,
} from './dataforseo'

// ── Bot taxonomy ───────────────────────────────────────────────────────────

export type BotSeverity = 'critical' | 'warn' | 'info'

interface BotImpact {
  /** What blocking this user-agent actually costs, in plain terms. */
  engine: string
  /**
   * critical = blocks an answer engine this tool measures (or Google Search).
   * warn     = degrades an LLM's corpus/grounding but not a measured engine.
   * info     = no effect on Search / AI Overviews / measured answer engines
   *            (the Google-Extended case — must never be a false alarm).
   */
  severity: BotSeverity
  note: string
}

/**
 * The user-agents we parse out of robots.txt, with the documented impact of
 * disallowing each. Order is the report order.
 */
export const BOT_IMPACTS: Record<string, BotImpact> = {
  Googlebot: {
    engine: 'Google Search + AI Overviews + AI Mode',
    severity: 'critical',
    note: 'Blocking Googlebot removes the site from Google Search AND Google AI Overviews / AI Mode (AI eligibility = Search eligibility).',
  },
  'Google-Extended': {
    engine: 'Gemini app / Vertex AI grounding & model training',
    severity: 'info',
    note: 'Blocking Google-Extended only affects Gemini app / Vertex grounding and Google model training. It does NOT affect Google Search, AI Overviews, or AI Mode.',
  },
  'OAI-SearchBot': {
    engine: 'ChatGPT Search (live answers + citations)',
    severity: 'critical',
    note: 'OAI-SearchBot powers ChatGPT Search citations. Blocking it removes the site from ChatGPT answers — a measured answer engine.',
  },
  GPTBot: {
    engine: 'OpenAI model training corpus',
    severity: 'warn',
    note: 'GPTBot is OpenAI training-only. Blocking it does not remove live ChatGPT Search citations (that is OAI-SearchBot) but shrinks the trained corpus.',
  },
  'ChatGPT-User': {
    engine: 'ChatGPT user-initiated browsing',
    severity: 'warn',
    note: 'ChatGPT-User fetches pages when a user explicitly asks ChatGPT to open a link. Blocking it breaks on-demand reads but not Search citations.',
  },
  PerplexityBot: {
    engine: 'Perplexity (answers + citations)',
    severity: 'critical',
    note: 'Blocking PerplexityBot removes the site from Perplexity answers — a measured answer engine.',
  },
  ClaudeBot: {
    engine: 'Claude (Anthropic crawler / citations)',
    severity: 'critical',
    note: 'Blocking ClaudeBot removes the site from Claude answers — a measured answer engine.',
  },
  'anthropic-ai': {
    engine: 'Anthropic (legacy user-agent)',
    severity: 'warn',
    note: 'Legacy Anthropic user-agent. Modern crawling uses ClaudeBot; kept for completeness.',
  },
  'Claude-Web': {
    engine: 'Claude user-initiated browsing (legacy)',
    severity: 'warn',
    note: 'Legacy Claude browsing user-agent. Blocking it has limited effect on current Claude citation behaviour.',
  },
  CCBot: {
    engine: 'Common Crawl (feeds many downstream LLMs)',
    severity: 'warn',
    note: 'Common Crawl indirectly feeds many LLM training sets. Blocking it is a broad-but-indirect reduction in AI corpus presence.',
  },
}

const TRACKED_BOTS = Object.keys(BOT_IMPACTS)

// ── robots.txt audit (free) ────────────────────────────────────────────────

interface RobotsGroup {
  agents: string[]
  disallow: string[]
  allow: string[]
}

export interface BotRule {
  userAgent: string
  /** True when the most-specific applicable group blocks the site root `/`. */
  blocked: boolean
  /** Which group decided it: the bot's own group, or the `*` fallback. */
  matchedVia: 'explicit' | 'wildcard' | 'default-allow'
  severity: BotSeverity
  engine: string
  note: string
}

export interface RobotsAudit {
  robotsTxtUrl: string
  /** false = no robots.txt (or unreachable); everything is allowed by default. */
  robotsTxtFound: boolean
  bots: BotRule[]
  /** Critical-severity bots that are blocked — these fail the KPI 6 gate. */
  blockedCriticalBots: string[]
  /**
   * Google-Extended specifically — surfaced so the UI/recommendations can
   * explain it as informational and never raise it as a Google AI failure.
   */
  googleExtendedBlocked: boolean
  fetchError: string | null
}

/** Split a robots.txt body into user-agent groups. */
function parseRobotsTxt(body: string): RobotsGroup[] {
  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  let lastLineWasAgent = false

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === 'user-agent') {
      // Consecutive User-agent lines share one rule block.
      if (!current || !lastLineWasAgent) {
        current = { agents: [], disallow: [], allow: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastLineWasAgent = true
      continue
    }

    lastLineWasAgent = false
    if (!current) continue
    if (field === 'disallow') current.disallow.push(value)
    else if (field === 'allow') current.allow.push(value)
  }
  return groups
}

/**
 * Resolve whether `botToken` is blocked from the site root.
 *
 * Selection: the group that names the bot explicitly wins; otherwise the `*`
 * group; otherwise default-allow. Root is "blocked" when the chosen group has
 * a `Disallow: /` (or `Disallow:` of the whole site) that isn't re-opened by
 * an equally-broad `Allow: /`. An empty `Disallow:` means allow-all.
 */
function resolveBotRule(groups: RobotsGroup[], botToken: string): {
  blocked: boolean
  matchedVia: BotRule['matchedVia']
} {
  const token = botToken.toLowerCase()
  const explicit = groups.find((g) => g.agents.includes(token))
  const wildcard = groups.find((g) => g.agents.includes('*'))
  const group = explicit ?? wildcard
  if (!group) return { blocked: false, matchedVia: 'default-allow' }

  const blocksRoot = group.disallow.some((p) => p === '/' || p === '/*')
  const reopensRoot = group.allow.some((p) => p === '/' || p === '/*')
  return {
    blocked: blocksRoot && !reopensRoot,
    matchedVia: explicit ? 'explicit' : 'wildcard',
  }
}

/**
 * Free robots.txt audit. Never throws — an unreachable robots.txt means the
 * crawler convention is "everything allowed", which is reported as such.
 */
export async function auditRobots(domain: string): Promise<RobotsAudit> {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const robotsTxtUrl = `https://${host}/robots.txt`

  let body = ''
  let robotsTxtFound = false
  let fetchError: string | null = null
  try {
    const res = await fetch(robotsTxtUrl, {
      redirect: 'follow',
      headers: { 'User-Agent': 'ProGrowth-AI-Readiness/1.0' },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.ok) {
      body = await res.text()
      robotsTxtFound = true
    } else if (res.status === 404) {
      robotsTxtFound = false // no robots.txt = full-crawl allowed
    } else {
      fetchError = `robots.txt returned HTTP ${res.status}`
    }
  } catch (e) {
    fetchError = e instanceof Error ? e.message : String(e)
  }

  const groups = robotsTxtFound ? parseRobotsTxt(body) : []
  const bots: BotRule[] = TRACKED_BOTS.map((bot) => {
    const impact = BOT_IMPACTS[bot]
    const { blocked, matchedVia } = robotsTxtFound
      ? resolveBotRule(groups, bot)
      : { blocked: false, matchedVia: 'default-allow' as const }
    return {
      userAgent: bot,
      blocked,
      matchedVia,
      severity: impact.severity,
      engine: impact.engine,
      note: impact.note,
    }
  })

  const blockedCriticalBots = bots
    .filter((b) => b.blocked && b.severity === 'critical')
    .map((b) => b.userAgent)
  const googleExtendedBlocked =
    bots.find((b) => b.userAgent === 'Google-Extended')?.blocked ?? false

  return {
    robotsTxtUrl,
    robotsTxtFound,
    bots,
    blockedCriticalBots,
    googleExtendedBlocked,
    fetchError,
  }
}

// ── Indexability audit (DataForSEO instant_pages + free directive fetch) ────

export interface IndexabilityAudit {
  url: string
  statusCode: number
  /** HTTP 200 (or 2xx) — the absolute baseline gate. */
  ok: boolean
  /**
   * The audit crawl could not fetch the page at all (statusCode 0 — no
   * response). This is INCONCLUSIVE, not a definitive non-2xx: it must NOT
   * hard-fail the Search-eligibility gate (a transient DataForSEO crawl
   * miss should not declare a live 200 page ineligible). Surfaced as a
   * warning instead. A real 4xx/5xx still sets ok=false and DOES fail.
   */
  fetchInconclusive: boolean
  hasNoindex: boolean
  /**
   * nosnippet / data-nosnippet / max-snippet:0 — these keep the page indexed
   * but suppress its content from AI Overviews & AI Mode. A distinct, silent
   * AI-visibility killer separate from noindex.
   */
  snippetSuppressed: boolean
  /** Exact directive tokens found, for the recommendations engine (26.7). */
  directives: {
    metaRobots: string | null
    xRobotsTag: string | null
    hasDataNosnippet: boolean
    tokens: string[]
  }
  canonical: string | null
  canonicalPresent: boolean
  title: string | null
  wordCount: number | null
  isHttps: boolean | null
  /** True only when the page is fully eligible for Search/AI snippets. */
  indexableForAi: boolean
  /**
   * EMERGING — INFORMATIONAL ONLY (Task 26.6). Never a hard gate; not part
   * of `indexableForAi` or the KPI 6 `searchEligible` decision. Derived at
   * zero extra API cost from the already-fetched instant_pages payload +
   * the page HTML we already pull for directive detection.
   */
  agentic: AgenticReadiness
  cost: number
}

/**
 * Agentic-readiness signals (Task 26.6, Workstream D). How well a non-JS
 * AI agent / the emerging agent-web can parse this page. STRICTLY
 * INFORMATIONAL — Google's documented eligibility is unchanged by any of
 * this; it never gates. UCP and agent-interaction protocols are mentioned
 * for awareness only and are likewise not requirements.
 */
export interface AgenticReadiness {
  semanticStructure: {
    hasH1: boolean
    /** Distinct heading levels present (h1..h6). */
    headingDepth: number
    hasMainLandmark: boolean
    hasNavLandmark: boolean
    hasArticleOrSectionLandmark: boolean
    score: 'strong' | 'moderate' | 'weak'
  }
  /** Risk that an agent NOT executing JS sees little/no main content. */
  jsGatingRisk: {
    plainTextRate: number | null
    scriptsCount: number | null
    renderBlockingScripts: number | null
    /** total_dom_size / transferred size — high ⇒ DOM largely client-built. */
    domToTransferRatio: number | null
    lowContentRate: boolean | null
    level: 'low' | 'moderate' | 'elevated' | 'unknown'
  }
  formsAccessible: {
    formCount: number
    inputCount: number
    labelOrAriaCount: number
    /** Heuristic: enough labels/aria for the inputs present. Informational. */
    likelyLabeled: boolean | null
  }
  /** Plain-language summary + the standing not-a-gate caveat. */
  note: string
}

function countMatches(html: string, re: RegExp): number {
  const m = html.match(re)
  return m ? m.length : 0
}

/**
 * Pure derivation — no I/O. `instantRaw` is the DataForSEO instant_pages
 * `item`; `html` is the already-fetched page HTML (may be ''). Everything
 * here is informational.
 */
export function deriveAgenticReadiness(instantRaw: any, html: string): AgenticReadiness {
  const meta = instantRaw?.meta ?? {}
  const checks = instantRaw?.checks ?? {}
  const htags = meta?.htags ?? {}

  // ── Semantic structure (headings from DataForSEO; landmarks from HTML) ──
  const hasH1 =
    (Array.isArray(htags?.h1) && htags.h1.length > 0) || checks?.no_h1_tag === false
  const headingDepth = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].filter(
    (h) => Array.isArray(htags?.[h]) && htags[h].length > 0
  ).length
  const hasMainLandmark = /<main[\s>]/i.test(html) || /role=["']main["']/i.test(html)
  const hasNavLandmark = /<nav[\s>]/i.test(html) || /role=["']navigation["']/i.test(html)
  const hasArticleOrSectionLandmark =
    /<article[\s>]/i.test(html) || /<section[\s>]/i.test(html) || /role=["'](article|region)["']/i.test(html)

  const ssScore: AgenticReadiness['semanticStructure']['score'] =
    hasH1 && hasMainLandmark && (hasNavLandmark || hasArticleOrSectionLandmark)
      ? 'strong'
      : !hasH1 || (!hasMainLandmark && !hasNavLandmark && !hasArticleOrSectionLandmark)
        ? 'weak'
        : 'moderate'

  // ── JS-gating risk (proxies; we did a single JS-on render so we infer) ──
  const plainTextRate: number | null =
    typeof meta?.content?.plain_text_rate === 'number' ? meta.content.plain_text_rate : null
  const scriptsCount: number | null =
    typeof meta?.scripts_count === 'number' ? meta.scripts_count : null
  const renderBlockingScripts: number | null =
    typeof meta?.render_blocking_scripts_count === 'number' ? meta.render_blocking_scripts_count : null
  const transferred = typeof instantRaw?.size === 'number' ? instantRaw.size : null
  const domSize = typeof instantRaw?.total_dom_size === 'number' ? instantRaw.total_dom_size : null
  const domToTransferRatio =
    transferred && transferred > 0 && domSize ? Math.round((domSize / transferred) * 10) / 10 : null
  const lowContentRate: boolean | null =
    typeof checks?.low_content_rate === 'boolean' ? checks.low_content_rate : null

  let jsLevel: AgenticReadiness['jsGatingRisk']['level']
  if (plainTextRate === null && lowContentRate === null) {
    jsLevel = 'unknown'
  } else if (
    (plainTextRate !== null && plainTextRate < 0.05) &&
    (lowContentRate === true || (domToTransferRatio !== null && domToTransferRatio > 8))
  ) {
    jsLevel = 'elevated'
  } else if (
    lowContentRate === true ||
    (plainTextRate !== null && plainTextRate < 0.1) ||
    (renderBlockingScripts !== null && renderBlockingScripts > 3)
  ) {
    jsLevel = 'moderate'
  } else {
    jsLevel = 'low'
  }

  // ── Forms / labels (from the already-fetched HTML) ──────────────────────
  const formCount = countMatches(html, /<form[\s>]/gi)
  const inputCount = countMatches(html, /<(input|select|textarea)[\s>]/gi)
  const labelOrAriaCount =
    countMatches(html, /<label[\s>]/gi) +
    countMatches(html, /aria-label(ledby)?=/gi)
  const likelyLabeled =
    inputCount === 0 ? null : labelOrAriaCount >= Math.ceil(inputCount * 0.5)

  const note =
    'Emerging & informational only — NOT a Search or AI eligibility gate (Google eligibility is unchanged by these signals). Indicates how well non-JS AI agents and the emerging agent-web (e.g. UCP / agent-interaction protocols, also informational, not requirements) can parse this page.'

  return {
    semanticStructure: { hasH1, headingDepth, hasMainLandmark, hasNavLandmark, hasArticleOrSectionLandmark, score: ssScore },
    jsGatingRisk: { plainTextRate, scriptsCount, renderBlockingScripts, domToTransferRatio, lowContentRate, level: jsLevel },
    formsAccessible: { formCount, inputCount, labelOrAriaCount, likelyLabeled },
    note,
  }
}

/**
 * Free, exact directive fetch. The DataForSEO instant_pages endpoint does not
 * reliably surface noindex/nosnippet/X-Robots-Tag (see the note in
 * lib/dataforseo.ts), so we read them straight from the live response headers
 * and HTML. `googlebot`-specific meta directives count too.
 */
async function fetchRobotsDirectives(url: string): Promise<{
  metaRobots: string | null
  xRobotsTag: string | null
  hasDataNosnippet: boolean
  tokens: string[]
  /** The page HTML we already fetched here — reused (zero extra cost) by
   *  deriveAgenticReadiness for landmark/form signals. '' on fetch failure. */
  html: string
}> {
  let html = ''
  let xRobotsTag: string | null = null
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'ProGrowth-AI-Readiness/1.0' },
      signal: AbortSignal.timeout(15_000),
    })
    xRobotsTag = res.headers.get('x-robots-tag')
    html = await res.text()
  } catch {
    // Network failure here just means we can't assert directives; the
    // DataForSEO status code from the caller still drives the hard gate.
    return { metaRobots: null, xRobotsTag: null, hasDataNosnippet: false, tokens: [], html: '' }
  }

  const headMatch = html.match(/<head[\s\S]*?<\/head>/i)
  const head = headMatch ? headMatch[0] : html.slice(0, 50_000)

  const metaRobotsMatch = head.match(
    /<meta[^>]+name=["'](?:robots|googlebot)["'][^>]*>/gi
  )
  let metaRobots: string | null = null
  if (metaRobotsMatch) {
    metaRobots = metaRobotsMatch
      .map((tag) => {
        const c = tag.match(/content=["']([^"']+)["']/i)
        return c ? c[1] : ''
      })
      .filter(Boolean)
      .join(', ')
      .toLowerCase() || null
  }

  const hasDataNosnippet = /\sdata-nosnippet[\s/>=]/i.test(html)

  const tokens = new Set<string>()
  const collect = (raw: string | null) => {
    if (!raw) return
    for (const part of raw.toLowerCase().split(',')) {
      const t = part.trim()
      if (t) tokens.add(t)
    }
  }
  collect(metaRobots)
  collect(xRobotsTag)
  if (hasDataNosnippet) tokens.add('data-nosnippet')

  return {
    metaRobots,
    xRobotsTag,
    hasDataNosnippet,
    tokens: [...tokens],
    html,
  }
}

function hasNoindexToken(tokens: string[]): boolean {
  return tokens.some((t) => t === 'noindex' || t === 'none')
}

function hasSnippetSuppressionToken(tokens: string[]): boolean {
  return tokens.some(
    (t) =>
      t === 'nosnippet' ||
      t === 'data-nosnippet' ||
      t === 'none' ||
      /^max-snippet\s*:\s*0$/.test(t)
  )
}

export async function auditIndexability(url: string): Promise<IndexabilityAudit> {
  // Run the paid crawl and the free directive fetch together. fetchOnPageInstant
  // throws DataForSeoCapExceededError if the daily cap is hit — propagated.
  const [instant, directives]: [OnPageInstantResult, Awaited<ReturnType<typeof fetchRobotsDirectives>>] =
    await Promise.all([fetchOnPageInstant(url), fetchRobotsDirectives(url)])

  const ok = instant.statusCode >= 200 && instant.statusCode < 300
  // statusCode 0 = the crawl returned no response at all → inconclusive,
  // NOT a definitive non-2xx. Distinguished so the gate doesn't false-fail
  // a live page on a transient crawl miss.
  const fetchInconclusive = instant.statusCode === 0
  const hasNoindex = hasNoindexToken(directives.tokens)
  const snippetSuppressed = hasSnippetSuppressionToken(directives.tokens)
  const canonicalPresent = !!instant.canonical
  const indexableForAi = ok && !hasNoindex && !snippetSuppressed

  // Keep the (potentially large) HTML out of the stored snapshot — it is
  // only an input to the zero-cost agentic derivation.
  const { html, ...directiveFields } = directives
  const agentic = deriveAgenticReadiness(instant.raw, html)

  return {
    url: instant.url,
    statusCode: instant.statusCode,
    ok,
    fetchInconclusive,
    hasNoindex,
    snippetSuppressed,
    directives: directiveFields,
    canonical: instant.canonical,
    canonicalPresent,
    title: instant.title,
    wordCount: instant.wordCount,
    isHttps: instant.isHttps,
    indexableForAi,
    agentic,
    cost: instant.cost,
  }
}

// ── Page-experience audit (DataForSEO Lighthouse → Google CWV thresholds) ──

/** Google "good" Core Web Vitals thresholds (field-aligned lab proxies). */
export const CWV_THRESHOLDS = {
  /** Largest Contentful Paint, ms. */
  lcpMs: 2500,
  /** Cumulative Layout Shift, unitless. */
  cls: 0.1,
  /** Total Blocking Time, ms — lab proxy for INP ≤ 200. */
  tbtMs: 200,
} as const

export interface PageExperienceAudit {
  url: string
  performanceScore: number | null
  lcpMs: number | null
  cls: number | null
  tbtMs: number | null
  lcpGood: boolean | null
  clsGood: boolean | null
  tbtGood: boolean | null
  isHttps: boolean | null
  /** All measurable CWV are within Google's "good" thresholds. */
  coreWebVitalsPass: boolean | null
  cost: number
}

function within(value: number | null, max: number): boolean | null {
  return value === null ? null : value <= max
}

export async function auditPageExperience(
  url: string,
  isHttps: boolean | null = null
): Promise<PageExperienceAudit> {
  // Throws DataForSeoCapExceededError if the daily cap is hit — propagated.
  const lh: OnPageLighthouseResult = await fetchOnPageLighthouse(url)

  const lcpGood = within(lh.lcpMs, CWV_THRESHOLDS.lcpMs)
  const clsGood = within(lh.cls, CWV_THRESHOLDS.cls)
  const tbtGood = within(lh.tbtMs, CWV_THRESHOLDS.tbtMs)

  const measured = [lcpGood, clsGood, tbtGood].filter((v) => v !== null) as boolean[]
  const coreWebVitalsPass = measured.length === 0 ? null : measured.every(Boolean)

  const httpsResolved = isHttps ?? (url.startsWith('https://') ? true : null)

  return {
    url,
    performanceScore: lh.performanceScore,
    lcpMs: lh.lcpMs,
    cls: lh.cls,
    tbtMs: lh.tbtMs,
    lcpGood,
    clsGood,
    tbtGood,
    isHttps: httpsResolved,
    coreWebVitalsPass,
    cost: lh.cost,
  }
}

// ── Aggregate: full AI-readiness for one URL ───────────────────────────────

export interface AiReadinessResult {
  domain: string
  url: string
  robots: RobotsAudit
  indexability: IndexabilityAudit
  pageExperience: PageExperienceAudit
  /**
   * The hard pass/fail KPI 6 gate, per Google's docs:
   *   HTTP 2xx  AND  no noindex/snippet suppression  AND  no critical
   *   answer-engine bot blocked in robots.txt.
   * Page-experience and Google-Extended are *not* part of the hard gate
   * (page experience is a ranking signal, not an eligibility gate;
   * Google-Extended is informational by design).
   */
  searchEligible: boolean
  /** Human-ordered reasons the gate failed (empty when searchEligible). */
  failures: string[]
  /** Non-blocking observations (page experience, Google-Extended, warns). */
  warnings: string[]
  totalCost: number
}

/**
 * Run all three audits for a single URL and compute the hard Search/AI
 * eligibility gate. robots is keyed off the URL's host. Paid sub-audits may
 * throw DataForSeoCapExceededError — intentionally not caught here so the
 * 26.4 cron can record a partial/skipped snapshot.
 */
export async function auditAiReadiness(url: string): Promise<AiReadinessResult> {
  const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const robots = await auditRobots(host)
  const indexability = await auditIndexability(url)
  const pageExperience = await auditPageExperience(url, indexability.isHttps)

  const failures: string[] = []
  const warnings: string[] = []

  if (indexability.fetchInconclusive) {
    warnings.push('Audit crawl could not fetch this page (no response) — INCONCLUSIVE, not counted against Search eligibility. Re-run to confirm; verify the URL resolves.')
  } else if (!indexability.ok) {
    failures.push(`Page returns HTTP ${indexability.statusCode} (not 2xx) — ineligible for Search & AI.`)
  }
  if (indexability.hasNoindex) {
    failures.push('Page carries a `noindex` directive — excluded from Search & all AI answer engines.')
  }
  if (indexability.snippetSuppressed) {
    failures.push('Snippet suppressed (`nosnippet` / `data-nosnippet` / `max-snippet:0`) — page stays indexed but its content cannot appear in AI Overviews / AI Mode.')
  }
  for (const bot of robots.blockedCriticalBots) {
    failures.push(`robots.txt blocks ${bot} (${BOT_IMPACTS[bot].engine}) — removes a measured answer engine.`)
  }

  if (!indexability.canonicalPresent) {
    warnings.push('No canonical tag found — recommended for consolidation, not a hard gate.')
  }
  if (robots.googleExtendedBlocked) {
    warnings.push('robots.txt blocks Google-Extended. INFORMATIONAL ONLY: this affects Gemini app / Vertex grounding & training, NOT Google Search, AI Overviews, or AI Mode. Not a Google AI failure.')
  }
  for (const b of robots.bots) {
    if (b.blocked && b.severity === 'warn') {
      warnings.push(`robots.txt blocks ${b.userAgent} (${b.engine}) — degrades AI corpus, not a measured engine.`)
    }
  }
  if (pageExperience.coreWebVitalsPass === false) {
    warnings.push('Core Web Vitals outside Google "good" thresholds — a ranking signal that weakens (does not block) Search/AI visibility.')
  }
  if (indexability.isHttps === false) {
    warnings.push('Page is not served over HTTPS — a baseline page-experience expectation.')
  }

  // Inconclusive fetch (statusCode 0) is NOT held against eligibility — only
  // a definitive non-2xx is. noindex/snippet/bot blocks still hard-fail.
  const searchEligible =
    (indexability.ok || indexability.fetchInconclusive) &&
    !indexability.hasNoindex &&
    !indexability.snippetSuppressed &&
    robots.blockedCriticalBots.length === 0

  return {
    domain: host,
    url,
    robots,
    indexability,
    pageExperience,
    searchEligible,
    failures,
    warnings,
    totalCost: indexability.cost + pageExperience.cost,
  }
}
