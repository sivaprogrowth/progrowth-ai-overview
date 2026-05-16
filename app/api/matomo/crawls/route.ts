import { NextRequest, NextResponse } from 'next/server'
import { fetchMatomoCrawls } from '@/lib/matomo'
import { extractKeywordsForPages } from '@/lib/keywords-from-url'
import { supabase } from '@/lib/supabase'
import { getClientFromRequest } from '@/lib/clientContext'
import {
  fetchMentionSearch,
  extractCorePhrases,
  checkDailyCap,
} from '@/lib/dataforseo'
import {
  parseMentionSearch,
  transformToRows,
  PlatformResult,
} from '@/lib/transform'

export const runtime = 'nodejs'
export const maxDuration = 60

function verifyAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === process.env.BATCH_API_KEY
  }
  try {
    const token = req.cookies.get('session')?.value
    if (!token) return false
    const [data, sig] = token.split('.')
    return !!data && !!sig
  } catch {
    return false
  }
}

// GET: Return cached crawl analyses for the resolved client from Supabase
export async function GET(req: NextRequest) {
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '10')
  const client = await getClientFromRequest(req)

  const { data, error } = await supabase
    .from('analyses')
    .select('id, domain, keywords, summary, created_at')
    .eq('client_id', client.id)
    .eq('summary->>source', 'matomo-crawl')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ analyses: data || [] })
}

// POST: Fetch crawl data from Matomo, run analysis, store results
export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = await getClientFromRequest(req)
  const domain = client.primary_domain

  if (!client.matomo_site_id) {
    return NextResponse.json({
      error: `Matomo is not configured for ${client.company_name}. Set matomo_site_id on the client first.`,
    }, { status: 400 })
  }

  // Check daily spending cap
  const cap = await checkDailyCap()
  if (!cap.allowed) {
    return NextResponse.json({
      error: `Daily API spending cap reached ($${cap.spent.toFixed(2)}/$${cap.cap.toFixed(2)}). Try again tomorrow.`,
    }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const period: 'week' | 'month' = body.period === 'month' ? 'month' : 'week'

  // Step 1: Fetch crawl data from Matomo (per-client, multi-tenant)
  let crawledPages
  try {
    crawledPages = await fetchMatomoCrawls({
      siteId: client.matomo_site_id,
      primaryDomain: client.primary_domain,
      matomoUrl: client.matomo_url,
      period,
    })
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to fetch Matomo data: ${err.message}` }, { status: 500 })
  }

  if (crawledPages.length === 0) {
    return NextResponse.json({ message: 'No AI bot crawls found', crawledPages: [] })
  }

  // Step 2: Extract keywords
  const pageKeywordsMap = extractKeywordsForPages(crawledPages, 3)
  const keywords = Array.from(pageKeywordsMap.values()).flat()

  if (keywords.length === 0) {
    return NextResponse.json({ message: 'No keywords extracted', crawledPages })
  }

  // Step 3: Run Google + ChatGPT analysis directly
  const corePhrases = extractCorePhrases(keywords)
  const mentionKeywords = [...keywords, ...corePhrases]
  const googleResults: any[] = []
  const chatgptResults: any[] = []

  for (let i = 0; i < mentionKeywords.length; i += 5) {
    const batch = mentionKeywords.slice(i, i + 5)
    const calls = batch.flatMap((kw) => {
      const target = [{ keyword: kw, match_type: 'partial_match' as const, search_scope: ['any' as const] }]
      return [
        fetchMentionSearch(target, 'google', 100).catch(() => null),
        fetchMentionSearch(target, 'chat_gpt', 100).catch(() => null),
      ]
    })
    const results = await Promise.all(calls)
    for (let j = 0; j < batch.length; j++) {
      googleResults.push(results[j * 2])
      chatgptResults.push(results[j * 2 + 1])
    }
  }

  function mergeResponses(responses: any[]): any {
    const allItems: any[] = []
    for (const res of responses) {
      for (const task of (res?.tasks || [])) {
        for (const result of (task?.result || [])) {
          allItems.push(...(result?.items || []))
        }
      }
    }
    return allItems.length > 0 ? { tasks: [{ result: [{ items: allItems }] }] } : null
  }

  const googleMap = parseMentionSearch(mergeResponses(googleResults), domain, mentionKeywords)
  const chatgptMap = parseMentionSearch(mergeResponses(chatgptResults), domain, mentionKeywords)

  // Merge core phrases into parent keywords
  for (const core of corePhrases) {
    const coreLower = core.toLowerCase()
    const parent = keywords.find((kw) =>
      core.toLowerCase().split(/\s+/).every((w) => kw.toLowerCase().split(/\s+/).includes(w))
    )
    if (parent) {
      const pLower = parent.toLowerCase()
      const gC = googleMap.get(coreLower), gP = googleMap.get(pLower)
      if (gC && gP) {
        for (const q of gC.queries) if (!gP.queries.some((eq) => eq.question === q.question)) gP.queries.push(q)
        if (!gP.aiSearchVolume && gC.aiSearchVolume) gP.aiSearchVolume = gC.aiSearchVolume
        for (const s of gC.allSources) if (!gP.allSources.find((es) => es.domain === s.domain)) gP.allSources.push(s)
      }
      const cC = chatgptMap.get(coreLower), cP = chatgptMap.get(pLower)
      if (cC && cP) {
        for (const q of cC.queries) if (!cP.queries.some((eq) => eq.question === q.question)) cP.queries.push(q)
        for (const s of cC.allSources) if (!cP.allSources.find((es) => es.domain === s.domain)) cP.allSources.push(s)
      }
    }
    googleMap.delete(coreLower)
    chatgptMap.delete(coreLower)
  }

  const rows = transformToRows(keywords, domain, {
    google: googleMap,
    chatgpt: chatgptMap,
    perplexity: new Map<string, PlatformResult>(),
    claude: new Map<string, PlatformResult>(),
  })

  const summary = {
    domain,
    totalKeywords: keywords.length,
    googlePresent: Array.from(googleMap.values()).filter((m) => m.domainFound).length,
    chatgptPresent: Array.from(chatgptMap.values()).filter((m) => m.domainFound).length,
    perplexityPresent: 0,
    claudePresent: 0,
    contentGaps: rows.filter((r) => r.content_gap).length,
    source: 'matomo-crawl',
    crawlMetadata: {
      period,
      fetchedAt: new Date().toISOString(),
      pages: crawledPages.map((p) => ({
        path: p.path,
        hits: p.hits,
        bots: p.bots,
        keywords: pageKeywordsMap.get(p.path) || [],
      })),
    },
  }

  // Step 4: Store in Supabase (scoped to the resolved client)
  const { error: insertErr } = await supabase
    .from('analyses')
    .insert({
      email: client.notification_email ?? 'system@progrowth.services',
      domain,
      client_id: client.id,
      keywords,
      summary,
      rows,
    })

  return NextResponse.json({
    crawledPages,
    keywords,
    pageKeywords: Object.fromEntries(pageKeywordsMap),
    rows,
    summary,
    stored: !insertErr,
    storeError: insertErr?.message || null,
  })
}
