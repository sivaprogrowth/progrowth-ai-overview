/**
 * Per-client Matomo crawl data (multi-tenant Phase 1).
 *
 * The Matomo connection details live in env (URL + auth token) — same
 * Matomo instance serves every tenant. The site ID + primary domain are
 * per-client (passed in by caller). If the client has no `matomo_site_id`
 * configured, the helpers throw with a "not configured" error so the
 * scorecard can render a pending state instead of failing the request.
 */

const MATOMO_URL = process.env.MATOMO_URL || ''
const MATOMO_TOKEN_AUTH = process.env.MATOMO_TOKEN_AUTH || ''

export interface CrawledPage {
  url: string
  path: string
  hits: number
  visits: number
  bots: string[]
}

export interface MatomoFetchOptions {
  siteId: string
  /** Origin used to absolutise relative paths in the returned URLs. */
  primaryDomain: string
  /** Override the env MATOMO_URL for clients hosted on a different instance. */
  matomoUrl?: string | null
  period?: 'week' | 'month'
}

const BOT_NAMES = ['ChatGPT', 'Claude', 'Perplexity', 'Gemini'] as const

const EXCLUDE_PATHS = [
  '/favicon.ico', '/robots.txt', '/sitemap.xml',
  '/_next/', '/api/', '/.well-known/',
]

async function matomoApi(matomoUrl: string, siteId: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${matomoUrl}/index.php`)
  url.searchParams.set('module', 'API')
  url.searchParams.set('format', 'json')
  url.searchParams.set('idSite', siteId)
  url.searchParams.set('token_auth', MATOMO_TOKEN_AUTH)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Matomo API error: ${res.status}`)
  return res.json()
}

export async function fetchMatomoCrawls(opts: MatomoFetchOptions): Promise<CrawledPage[]> {
  const matomoUrl = opts.matomoUrl || MATOMO_URL
  if (!matomoUrl || !MATOMO_TOKEN_AUTH) {
    throw new Error('MATOMO_URL and MATOMO_TOKEN_AUTH env vars are required')
  }
  if (!opts.siteId) {
    throw new Error('matomo_site_id not configured for this client')
  }
  const period = opts.period ?? 'week'

  const allPages = await matomoApi(matomoUrl, opts.siteId, {
    method: 'Actions.getPageUrls',
    period,
    date: 'today',
    segment: 'dimension2==AI+Crawler',
    flat: '1',
  })

  if (!Array.isArray(allPages) || allPages.length === 0) return []

  const botResults = await Promise.all(
    BOT_NAMES.map((bot) =>
      matomoApi(matomoUrl, opts.siteId, {
        method: 'Actions.getPageUrls',
        period,
        date: 'today',
        segment: `dimension2==AI+Crawler;dimension1==${bot}`,
        flat: '1',
      }).catch(() => [])
    )
  )

  const botPathMap = new Map<string, Set<string>>()
  BOT_NAMES.forEach((bot, i) => {
    const pages = Array.isArray(botResults[i]) ? botResults[i] : []
    for (const page of pages) {
      const path = page.label || page.Actions_PageUrl || ''
      if (!botPathMap.has(path)) botPathMap.set(path, new Set())
      botPathMap.get(path)!.add(bot)
    }
  })

  return allPages
    .map((page: any) => {
      const path = page.label || page.Actions_PageUrl || ''
      const url = page.url || `https://www.${opts.primaryDomain}${path}`
      return {
        url,
        path,
        hits: page.nb_hits || 0,
        visits: page.nb_visits || 0,
        bots: Array.from(botPathMap.get(path) || []),
      }
    })
    .filter((p: CrawledPage) => {
      if (p.hits < 1) return false
      if (EXCLUDE_PATHS.some((ex) => p.path.startsWith(ex))) return false
      return true
    })
    .sort((a: CrawledPage, b: CrawledPage) => b.hits - a.hits)
}
