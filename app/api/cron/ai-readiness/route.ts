import { NextRequest, NextResponse } from 'next/server'
import {
  auditRobots,
  auditIndexability,
  auditPageExperience,
  deriveAgenticReadiness,
  BOT_IMPACTS,
  type RobotsAudit,
  type IndexabilityAudit,
  type PageExperienceAudit,
} from '@/lib/aiReadiness'
import { DataForSeoCapExceededError } from '@/lib/dataforseo'
import { getClientFromRequest } from '@/lib/clientContext'
import { listActiveClients, type Client } from '@/lib/clients'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const SNAPSHOT_DOMAIN = '__ai_readiness_snapshot__'
const DEFAULT_MAX_PAGES = 6

/**
 * GET /api/cron/ai-readiness
 *
 * KPI 6 technical AI-readiness audit. Per Google's AI-features guidance,
 * eligibility for AI Overviews / AI Mode == standard Search snippet
 * eligibility — so this audits the real automatable gates only: robots.txt
 * answer-engine access, indexability/snippet directives, and Core Web Vitals.
 *
 * Two modes (mirrors the geo-seo-gap fan-out pattern, keeps the Hobby
 * 2-Vercel-cron cap — this route is triggered by an existing cron / manual
 * call, not a 3rd vercel.json entry):
 *
 *   • `?client=<slug>` present  → SINGLE client audit, stores one snapshot.
 *   • `?client=` absent         → FAN-OUT: self-fetches this route once per
 *                                  `cron_enabled` active client, forwarding
 *                                  `Authorization: Bearer ${CRON_SECRET}`.
 *
 * Single-mode query params:
 *   ?client=<slug>     which tenant to audit
 *   ?urls=a,b,c        explicit URL set (overrides sitemap discovery)
 *   ?max=N             cap audited pages (default 6, incl. homepage)
 *
 * Cost: ~$0.005/page (instant_pages + lighthouse), so ~$0.03/client/run at
 * the default 6 pages. Every paid call is cap-guarded inside lib/dataforseo;
 * hitting DATAFORSEO_DAILY_CAP stops the run early and stores a partial
 * snapshot rather than failing. Auth handled by middleware.
 */
export async function GET(req: NextRequest) {
  const hasClientParam = !!req.nextUrl.searchParams.get('client')

  if (!hasClientParam) {
    return fanOut(req)
  }

  const client = await getClientFromRequest(req)
  const result = await auditClient(client, req)
  return NextResponse.json(result)
}

// ── Fan-out dispatcher ─────────────────────────────────────────────────────

async function fanOut(req: NextRequest): Promise<NextResponse> {
  const clients = (await listActiveClients()).filter((c) => c.cron_enabled)
  const cronSecret = process.env.CRON_SECRET
  const origin = req.nextUrl.origin

  const dispatched = await Promise.allSettled(
    clients.map((c) =>
      fetch(`${origin}/api/cron/ai-readiness?client=${encodeURIComponent(c.slug)}`, {
        headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
        signal: AbortSignal.timeout(55_000),
      }).then(async (r) => ({ slug: c.slug, status: r.status, body: await r.json().catch(() => null) }))
    )
  )

  return NextResponse.json({
    mode: 'fan-out',
    cronEnabledClients: clients.map((c) => c.slug),
    dispatched: dispatched.map((d, i) =>
      d.status === 'fulfilled'
        ? { slug: clients[i].slug, ok: true, status: d.value.status, searchEligible: d.value.body?.searchEligible ?? null }
        : { slug: clients[i].slug, ok: false, error: String(d.reason) }
    ),
  })
}

// ── Single-client audit ────────────────────────────────────────────────────

interface PageAudit {
  url: string
  searchEligible: boolean
  indexability: IndexabilityAudit
  pageExperience: PageExperienceAudit | null
  failures: string[]
  warnings: string[]
}

async function auditClient(client: Client, req: NextRequest) {
  const maxParam = parseInt(req.nextUrl.searchParams.get('max') ?? '', 10)
  const maxPages = Number.isFinite(maxParam) && maxParam > 0 ? Math.min(maxParam, 15) : DEFAULT_MAX_PAGES
  const urlsParam = req.nextUrl.searchParams.get('urls')

  const primary = client.primary_domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const homepage = `https://${primary}/`

  let targetUrls: string[]
  if (urlsParam) {
    targetUrls = urlsParam.split(',').map((u) => u.trim()).filter(Boolean).slice(0, maxPages)
  } else {
    const sitemapUrls = await discoverSitemapUrls(primary, maxPages - 1)
    targetUrls = dedupe([homepage, ...sitemapUrls]).slice(0, maxPages)
  }

  // robots.txt is host-level and free — audit once, reuse across every page.
  const robots = await auditRobots(primary)

  const pages: PageAudit[] = []
  let capReached = false
  let totalCost = 0

  for (const url of targetUrls) {
    try {
      const indexability = await auditIndexability(url)
      let pageExperience: PageExperienceAudit | null = null
      try {
        pageExperience = await auditPageExperience(url, indexability.isHttps)
      } catch (e) {
        if (e instanceof DataForSeoCapExceededError) {
          capReached = true
        } else {
          throw e
        }
      }
      totalCost += indexability.cost + (pageExperience?.cost ?? 0)
      pages.push(composePageAudit(url, robots, indexability, pageExperience))
      if (capReached) break
    } catch (e) {
      if (e instanceof DataForSeoCapExceededError) {
        capReached = true
        break
      }
      // A single unreachable page must not abort the whole client run.
      pages.push({
        url,
        searchEligible: false,
        indexability: {
          url, statusCode: 0, ok: false, fetchInconclusive: true,
          hasNoindex: false, snippetSuppressed: false,
          directives: { metaRobots: null, xRobotsTag: null, hasDataNosnippet: false, tokens: [] },
          canonical: null, canonicalPresent: false, title: null, wordCount: null,
          isHttps: null, indexableForAi: false,
          agentic: deriveAgenticReadiness({}, ''),
          cost: 0,
        },
        pageExperience: null,
        failures: [`Audit error for ${url}: ${e instanceof Error ? e.message : String(e)}`],
        warnings: [],
      })
    }
  }

  const citedByEngines = await fetchCitedEngines(client)

  // Site-level hard gate: no critical answer-engine bot blocked AND every
  // CONCLUSIVELY-audited page is indexable for AI (2xx, no noindex, no
  // snippet suppression). Inconclusive pages (crawl returned no response —
  // a transient DataForSEO miss, not a definitive non-2xx) are excluded
  // from the gate and surfaced as a warning, so they can't false-fail a
  // live site. The gate needs at least one conclusive page to pass.
  const conclusive = pages.filter((p) => !p.indexability.fetchInconclusive)
  const inconclusiveUrls = pages
    .filter((p) => p.indexability.fetchInconclusive)
    .map((p) => p.url)
  const allPagesIndexable =
    conclusive.length > 0 && conclusive.every((p) => p.indexability.indexableForAi)
  const searchEligible = robots.blockedCriticalBots.length === 0 && allPagesIndexable
  const inconclusiveWarning =
    inconclusiveUrls.length > 0
      ? [`Audit crawl could not fetch ${inconclusiveUrls.length} page(s) — INCONCLUSIVE, excluded from the eligibility gate (not a non-2xx): ${inconclusiveUrls.join(', ')}`]
      : []

  const summary = {
    source: 'ai-readiness',
    generatedAt: new Date().toISOString(),
    searchEligible,
    capReached,
    pagesAudited: pages.length,
    pagesRequested: targetUrls.length,
    totalCost: Math.round(totalCost * 10000) / 10000,
    robots: {
      robotsTxtFound: robots.robotsTxtFound,
      robotsTxtUrl: robots.robotsTxtUrl,
      blockedCriticalBots: robots.blockedCriticalBots,
      googleExtendedBlocked: robots.googleExtendedBlocked,
      bots: robots.bots.map((b) => ({
        userAgent: b.userAgent,
        blocked: b.blocked,
        severity: b.severity,
        engine: b.engine,
      })),
      fetchError: robots.fetchError,
    },
    pageExperience: aggregatePageExperience(pages),
    // EMERGING — INFORMATIONAL ONLY. Roll-up of the per-page agentic
    // signals; deliberately NOT part of searchEligible or any gate.
    agentic: aggregateAgentic(pages),
    citationContext: { citedByEngines },
    failures: aggregateMessages(robots, pages, 'failures'),
    warnings: [...inconclusiveWarning, ...aggregateMessages(robots, pages, 'warnings')],
  }

  const { error } = await supabase.from('analyses').insert({
    email: client.notification_email ?? 'system@progrowth.services',
    domain: SNAPSHOT_DOMAIN,
    client_id: client.id,
    keywords: targetUrls,
    summary,
    rows: pages.map((p) => ({
      url: p.url,
      searchEligible: p.searchEligible,
      statusCode: p.indexability.statusCode,
      hasNoindex: p.indexability.hasNoindex,
      snippetSuppressed: p.indexability.snippetSuppressed,
      canonicalPresent: p.indexability.canonicalPresent,
      isHttps: p.indexability.isHttps,
      directiveTokens: p.indexability.directives.tokens,
      lcpMs: p.pageExperience?.lcpMs ?? null,
      cls: p.pageExperience?.cls ?? null,
      tbtMs: p.pageExperience?.tbtMs ?? null,
      coreWebVitalsPass: p.pageExperience?.coreWebVitalsPass ?? null,
      performanceScore: p.pageExperience?.performanceScore ?? null,
      // Emerging/informational only — never affects searchEligible.
      agentic: p.indexability.agentic,
      failures: p.failures,
      warnings: p.warnings,
    })),
  })

  return {
    mode: 'single',
    client: { id: client.id, slug: client.slug },
    ...summary,
    stored: !error,
    storeError: error?.message ?? null,
  }
}

// ── Per-page gate composition (shared host-level robots) ───────────────────

function composePageAudit(
  url: string,
  robots: RobotsAudit,
  indexability: IndexabilityAudit,
  pageExperience: PageExperienceAudit | null
): PageAudit {
  const failures: string[] = []
  const warnings: string[] = []

  if (indexability.fetchInconclusive) {
    warnings.push('Audit crawl could not fetch this page (no response) — INCONCLUSIVE, not counted against Search eligibility. Verify the URL resolves; re-run to confirm.')
  } else if (!indexability.ok) {
    failures.push(`Page returns HTTP ${indexability.statusCode} (not 2xx) — ineligible for Search & AI.`)
  }
  if (indexability.hasNoindex) {
    failures.push('Page carries a `noindex` directive — excluded from Search & all AI answer engines.')
  }
  if (indexability.snippetSuppressed) {
    failures.push('Snippet suppressed (`nosnippet` / `data-nosnippet` / `max-snippet:0`) — page stays indexed but cannot appear in AI Overviews / AI Mode.')
  }
  for (const bot of robots.blockedCriticalBots) {
    failures.push(`robots.txt blocks ${bot} (${BOT_IMPACTS[bot].engine}) — removes a measured answer engine.`)
  }

  if (!indexability.canonicalPresent) {
    warnings.push('No canonical tag found — recommended for consolidation, not a hard gate.')
  }
  if (robots.googleExtendedBlocked) {
    warnings.push('robots.txt blocks Google-Extended. INFORMATIONAL ONLY: affects Gemini app / Vertex grounding & training, NOT Google Search, AI Overviews, or AI Mode.')
  }
  if (pageExperience?.coreWebVitalsPass === false) {
    warnings.push('Core Web Vitals outside Google "good" thresholds — a ranking signal that weakens (does not block) Search/AI visibility.')
  }
  if (indexability.isHttps === false) {
    warnings.push('Page is not served over HTTPS — a baseline page-experience expectation.')
  }

  const searchEligible =
    indexability.indexableForAi && robots.blockedCriticalBots.length === 0

  return { url, searchEligible, indexability, pageExperience, failures, warnings }
}

function aggregateMessages(
  robots: RobotsAudit,
  pages: PageAudit[],
  key: 'failures' | 'warnings'
): string[] {
  const out = new Set<string>()
  // robots-derived messages are host-level — dedupe across pages.
  for (const p of pages) for (const m of p[key]) out.add(m)
  return [...out]
}

function aggregatePageExperience(pages: PageAudit[]) {
  const measured = pages.map((p) => p.pageExperience).filter((p): p is PageExperienceAudit => !!p)
  if (measured.length === 0) return null
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null)
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null
  }
  return {
    pagesMeasured: measured.length,
    avgPerformanceScore: avg(measured.map((m) => m.performanceScore)),
    avgLcpMs: avg(measured.map((m) => m.lcpMs)),
    avgCls: avg(measured.map((m) => m.cls)),
    avgTbtMs: avg(measured.map((m) => m.tbtMs)),
    allCoreWebVitalsPass: measured.every((m) => m.coreWebVitalsPass === true),
  }
}

/**
 * Informational roll-up of per-page agentic signals. NOT a gate — purely
 * an "emerging" awareness section per Task 26.6 / Workstream D.
 */
function aggregateAgentic(pages: PageAudit[]) {
  const a = pages.map((p) => p.indexability.agentic)
  if (a.length === 0) return null
  const tally = <T extends string>(xs: T[]) =>
    xs.reduce<Record<string, number>>((acc, x) => ((acc[x] = (acc[x] ?? 0) + 1), acc), {})
  return {
    pages: a.length,
    semanticStructure: tally(a.map((x) => x.semanticStructure.score)),
    jsGatingRisk: tally(a.map((x) => x.jsGatingRisk.level)),
    pagesWithMainLandmark: a.filter((x) => x.semanticStructure.hasMainLandmark).length,
    pagesWithForms: a.filter((x) => x.formsAccessible.formCount > 0).length,
    pagesFormsLikelyLabeled: a.filter((x) => x.formsAccessible.likelyLabeled === true).length,
    note: a[0].note,
  }
}

// ── Helpers: sitemap discovery (free) + citation-snapshot context ──────────

/**
 * Free page discovery from sitemap.xml. Handles a sitemap index (one level
 * of nesting). Prefers shallow paths (likely-important pages) and returns at
 * most `limit` URLs. Returns [] on any failure — the homepage audit alone is
 * still a valid run.
 */
async function discoverSitemapUrls(host: string, limit: number): Promise<string[]> {
  if (limit <= 0) return []
  try {
    const locs = await fetchSitemapLocs(`https://${host}/sitemap.xml`)
    const childSitemaps = locs.filter((l) => /\.xml($|\?)/i.test(l)).slice(0, 3)
    const pageUrls = locs.filter((l) => !/\.xml($|\?)/i.test(l))

    if (pageUrls.length === 0 && childSitemaps.length > 0) {
      for (const sm of childSitemaps) {
        pageUrls.push(...(await fetchSitemapLocs(sm)).filter((l) => !/\.xml($|\?)/i.test(l)))
        if (pageUrls.length >= limit * 3) break
      }
    }

    return dedupe(pageUrls)
      .filter((u) => {
        try {
          return new URL(u).hostname.replace(/^www\./, '') === host.replace(/^www\./, '')
        } catch {
          return false
        }
      })
      .sort((a, b) => pathDepth(a) - pathDepth(b))
      .slice(0, limit)
  } catch {
    return []
  }
}

async function fetchSitemapLocs(url: string): Promise<string[]> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'ProGrowth-AI-Readiness/1.0' },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return []
  const xml = await res.text()
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1])
}

function pathDepth(u: string): number {
  try {
    return new URL(u).pathname.replace(/\/$/, '').split('/').filter(Boolean).length
  } catch {
    return 99
  }
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)]
}

/**
 * Reads the client's latest citation-network snapshot purely for correlation
 * context (which answer engines currently cite the brand). Zero API cost.
 * Tolerates absence — returns [] before the first citation-network run.
 */
async function fetchCitedEngines(client: Client): Promise<string[]> {
  try {
    const { data } = await supabase
      .from('analyses')
      .select('summary')
      .eq('client_id', client.id)
      .eq('domain', '__citation_network_snapshot__')
      .order('created_at', { ascending: false })
      .limit(1)
    const appearances: any[] =
      (data?.[0]?.summary as any)?.brandAppearances ??
      (data?.[0]?.summary as any)?.progrowthAppearances ??
      []
    return [...new Set(appearances.map((a) => a.engine).filter(Boolean))]
  } catch {
    return []
  }
}
