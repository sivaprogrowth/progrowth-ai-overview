/**
 * Lightweight public AI-readiness checks (Phase 1).
 *
 * Deliberately NOT a crawler: three fetches total (homepage, robots.txt,
 * sitemap.xml), each capped by timeout, response-size and redirect limits so
 * a malicious or oversized target cannot turn a public POST into a resource
 * sink. This is the SSRF-safety boundary alongside lib/grader/normalize.ts
 * — normalize.ts refuses the target host up front, this module bounds what
 * happens once a fetch to an allowed host is actually made.
 *
 * lib/aiReadiness.ts (auditRobots) already does a careful per-bot robots.txt
 * parse for the internal product; it is reused as-is rather than
 * reimplemented. Its two paid DataForSEO checks (auditIndexability,
 * auditPageExperience) are NOT used here — Phase 1 readiness must be free
 * and must never touch the DataForSEO daily cap, which the visibility
 * queries already spend against.
 *
 * Any single check may fail without failing the others: each is wrapped so
 * one dead endpoint (e.g. sitemap.xml 404) degrades to `passed: null`
 * ("could not be determined") rather than throwing.
 */

import { auditRobots } from '../aiReadiness'
import type { BrandMatcher } from './brand-matcher'
import type { ReadinessCheck, ReadinessResult } from './types'

const FETCH_TIMEOUT_MS = 8_000
/** Refuse to buffer more than this from any single fetch (bytes). */
const MAX_BODY_BYTES = 2_000_000
const MAX_REDIRECTS = 5

interface BoundedFetchResult {
  ok: boolean
  status: number
  text: string
  error: string | null
}

/**
 * fetch() with an enforced timeout, a manual bounded-redirect walk (so a
 * redirect chain can't be used to bounce off an internal host after
 * normalize.ts already approved the original), and a body-size cap.
 */
async function boundedFetch(url: string): Promise<BoundedFetchResult> {
  let current = url
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        redirect: 'manual',
        headers: { 'User-Agent': 'ProGrowth-AI-Grader/1.0' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const location = res.headers.get('location')
        if (!location || hop === MAX_REDIRECTS) {
          return { ok: false, status: res.status, text: '', error: 'too many redirects' }
        }
        current = new URL(location, current).toString()
        if (!current.startsWith('https://') && !current.startsWith('http://')) {
          return { ok: false, status: 0, text: '', error: 'redirected to an unsupported scheme' }
        }
        continue
      }

      const reader = res.body?.getReader()
      if (!reader) {
        const text = await res.text()
        return { ok: res.ok, status: res.status, text: text.slice(0, MAX_BODY_BYTES), error: null }
      }
      const decoder = new TextDecoder()
      let text = ''
      let bytes = 0
      while (bytes < MAX_BODY_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        text += decoder.decode(value, { stream: true })
      }
      reader.cancel().catch(() => {})
      return { ok: res.ok, status: res.status, text, error: null }
    }
    return { ok: false, status: 0, text: '', error: 'too many redirects' }
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e instanceof Error ? e.message : 'fetch failed' }
  }
}

function check(id: string, label: string, passed: boolean | null, detail: string): ReadinessCheck {
  return { id, label, passed, detail }
}

/** True if the HTML carries any JSON-LD block, regardless of @type. */
function hasStructuredData(html: string): boolean {
  return /<script[^>]+type=["']application\/ld\+json["']/i.test(html)
}

/** True if a JSON-LD block declares an Organization/LocalBusiness @type. */
function hasOrganizationSchema(html: string): boolean {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? []
  for (const block of blocks) {
    const body = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '')
    if (/"@type"\s*:\s*"(?:[^"]*)?(Organization|LocalBusiness|Corporation)"/i.test(body)) return true
  }
  return false
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)
  return m ? m[1].trim() || null : null
}

function extractMetaDescription(html: string): string | null {
  const m = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,500})["']/i)
  return m ? m[1].trim() || null : null
}

/**
 * Run the lightweight readiness audit. Never throws — every failure mode
 * degrades a single check to `passed: null` and the overall `status` to
 * 'partial' or 'unavailable'.
 */
export async function auditGraderReadiness(
  homepageUrl: string,
  matcher: BrandMatcher
): Promise<ReadinessResult> {
  const checks: ReadinessCheck[] = []
  let fatal: string | null = null

  try {
    const home = await boundedFetch(homepageUrl)
    const homeReachable = home.error === null && home.status >= 200 && home.status < 400
    checks.push(
      check(
        'homepage_reachable',
        'Homepage reachable',
        home.error === null ? homeReachable : null,
        home.error ? `Could not fetch homepage: ${home.error}` : `HTTP ${home.status}`
      )
    )

    const html = home.error === null ? home.text : ''
    const title = html ? extractTitle(html) : null
    checks.push(
      check('title_exists', 'Page title present', html ? title !== null && title.length > 0 : null,
        title ? `Title: "${title.slice(0, 80)}"` : 'No <title> tag found or homepage unreachable')
    )

    const description = html ? extractMetaDescription(html) : null
    checks.push(
      check('meta_description', 'Meta description present', html ? description !== null : null,
        description ? `${description.length} characters` : 'No meta description found or homepage unreachable')
    )

    checks.push(
      check('structured_data', 'Structured data (JSON-LD) present', html ? hasStructuredData(html) : null,
        html ? (hasStructuredData(html) ? 'JSON-LD block found' : 'No JSON-LD block found') : 'Homepage unreachable')
    )

    checks.push(
      check('organization_schema', 'Organization/LocalBusiness schema present', html ? hasOrganizationSchema(html) : null,
        html
          ? (hasOrganizationSchema(html) ? 'Organization-type JSON-LD found' : 'No Organization/LocalBusiness schema found')
          : 'Homepage unreachable')
    )

    const brandNamed = html ? matcher.mentionedIn(title ?? '') || matcher.mentionedIn(html.slice(0, 5000)) : null
    checks.push(
      check('brand_naming', 'Clear company/brand naming on homepage', brandNamed,
        brandNamed === null ? 'Homepage unreachable' : brandNamed ? 'Brand name found on homepage' : 'Brand name not found in title or above-the-fold content')
    )

    const serviceLanguage = html
      ? /\b(services?|solutions?|products?|industries?|about us|what we do)\b/i.test(html.slice(0, 8000))
      : null
    checks.push(
      check('service_language', 'Service/category language visible', serviceLanguage,
        serviceLanguage === null ? 'Homepage unreachable' : serviceLanguage ? 'Service/category language found' : 'No clear service/category language found above the fold')
    )
  } catch (e) {
    fatal = e instanceof Error ? e.message : 'homepage checks failed unexpectedly'
  }

  try {
    const host = homepageUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const robots = await auditRobots(host)
    checks.push(
      check('robots_reachable', 'robots.txt reachable', robots.fetchError ? null : true,
        robots.fetchError ?? (robots.robotsTxtFound ? 'robots.txt found' : 'No robots.txt (full crawl allowed by default)'))
    )
    checks.push(
      check('robots_no_critical_block', 'No critical answer-engine bot blocked', robots.fetchError ? null : robots.blockedCriticalBots.length === 0,
        robots.blockedCriticalBots.length > 0
          ? `Blocks: ${robots.blockedCriticalBots.join(', ')}`
          : 'No critical bots blocked')
    )
  } catch (e) {
    checks.push(check('robots_reachable', 'robots.txt reachable', null, e instanceof Error ? e.message : 'robots.txt check failed'))
    checks.push(check('robots_no_critical_block', 'No critical answer-engine bot blocked', null, 'Could not evaluate — robots.txt check failed'))
  }

  try {
    const host = homepageUrl.replace(/\/$/, '')
    const sitemap = await boundedFetch(`${host}/sitemap.xml`)
    const found = sitemap.error === null && sitemap.status >= 200 && sitemap.status < 300
    checks.push(
      check('sitemap_reachable', 'sitemap.xml reachable', sitemap.error ? null : found,
        sitemap.error ? sitemap.error : found ? 'sitemap.xml found' : `HTTP ${sitemap.status}`)
    )
  } catch (e) {
    checks.push(check('sitemap_reachable', 'sitemap.xml reachable', null, e instanceof Error ? e.message : 'sitemap.xml check failed'))
  }

  const evaluated = checks.filter((c) => c.passed !== null)
  const passedCount = evaluated.filter((c) => c.passed === true).length

  const status: ReadinessResult['status'] =
    fatal || evaluated.length === 0 ? 'unavailable' : evaluated.length < checks.length ? 'partial' : 'ok'

  return {
    status,
    checks,
    passedCount,
    evaluatedCount: evaluated.length,
    error: fatal,
  }
}
