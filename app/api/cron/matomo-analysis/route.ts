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

export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel injects this for cron jobs)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    // Also allow BATCH_API_KEY for manual triggers
    const batchKey = process.env.BATCH_API_KEY
    if (!batchKey || authHeader !== `Bearer ${batchKey}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const client = await getClientFromRequest(req)
  const domain = client.primary_domain

  if (!client.matomo_site_id) {
    return NextResponse.json({
      skipped: 'no matomo_site_id configured for this client',
      client: { id: client.id, slug: client.slug },
    })
  }

  // Check daily spending cap
  const cap = await checkDailyCap()
  if (!cap.allowed) {
    return NextResponse.json({ error: `Daily cap reached ($${cap.spent.toFixed(2)}/$${cap.cap.toFixed(2)})` }, { status: 429 })
  }

  // Check for existing analysis this week (dedup, per-client)
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: existing } = await supabase
    .from('analyses')
    .select('id, created_at')
    .eq('client_id', client.id)
    .eq('summary->>source', 'matomo-crawl')
    .gte('created_at', oneWeekAgo)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({
      message: 'Analysis already exists for this week',
      existingId: existing[0].id,
      createdAt: existing[0].created_at,
    })
  }

  // Fetch crawl data
  let crawledPages
  try {
    crawledPages = await fetchMatomoCrawls({
      siteId: client.matomo_site_id,
      primaryDomain: client.primary_domain,
      matomoUrl: client.matomo_url,
      period: 'week',
    })
  } catch (err: any) {
    return NextResponse.json({ error: `Matomo fetch failed: ${err.message}` }, { status: 500 })
  }

  if (crawledPages.length === 0) {
    return NextResponse.json({ message: 'No AI bot crawls this week' })
  }

  // Extract keywords
  const pageKeywordsMap = extractKeywordsForPages(crawledPages, 3)
  const keywords = Array.from(pageKeywordsMap.values()).flat()

  if (keywords.length === 0) {
    return NextResponse.json({ message: 'No keywords extracted' })
  }

  // Run Google + ChatGPT analysis only (fast, cheap)
  const corePhrases = extractCorePhrases(keywords)
  const mentionKeywords = [...keywords, ...corePhrases]

  const googleResults: any[] = []
  const chatgptResults: any[] = []
  const batchSize = 5

  for (let i = 0; i < mentionKeywords.length; i += batchSize) {
    const batch = mentionKeywords.slice(i, i + batchSize)
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

  // Merge core phrases
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
  }, client.competitor_sites)

  const summary = {
    domain,
    totalKeywords: keywords.length,
    googlePresent: Array.from(googleMap.values()).filter((m) => m.domainFound).length,
    chatgptPresent: Array.from(chatgptMap.values()).filter((m) => m.domainFound).length,
    perplexityPresent: 0,
    claudePresent: 0,
    contentGaps: rows.filter((r) => r.content_gap).length,
  }

  const crawlMetadata = {
    period: 'week',
    fetchedAt: new Date().toISOString(),
    pages: crawledPages.map((p) => ({
      path: p.path,
      hits: p.hits,
      bots: p.bots,
      keywords: pageKeywordsMap.get(p.path) || [],
    })),
  }

  const { error: insertErr } = await supabase
    .from('analyses')
    .insert({
      email: client.notification_email ?? 'system@progrowth.services',
      domain,
      client_id: client.id,
      keywords,
      summary: { ...summary, source: 'matomo-crawl', crawlMetadata },
      rows,
    })

  if (insertErr) {
    console.error('Cron: failed to store analysis:', insertErr)
    return NextResponse.json({ error: 'Failed to store results' }, { status: 500 })
  }

  return NextResponse.json({
    message: 'Matomo crawl analysis completed',
    crawledPages: crawledPages.length,
    keywords: keywords.length,
    summary,
  })
}
