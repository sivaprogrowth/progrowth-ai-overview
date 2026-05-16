import { NextRequest, NextResponse } from 'next/server'
import {
  fetchMentionSearch,
  fetchLlmResponse,
  extractCorePhrases,
  LLM_MODELS,
  checkDailyCap,
} from '@/lib/dataforseo'
import {
  parseMentionSearch,
  parseLlmResponseResult,
  transformToRows,
  PlatformResult,
} from '@/lib/transform'
import { supabase } from '@/lib/supabase'
import { extractKeywordsForPages } from '@/lib/keywords-from-url'

export const runtime = 'nodejs'
export const maxDuration = 60

function verifyBearerAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return false
  const token = authHeader.slice(7)
  return token === process.env.BATCH_API_KEY
}

interface BatchRequest {
  domain: string
  pages: Array<{ url: string; path: string; hits: number; bots: string[] }>
  skipLiveQueries?: boolean
  maxKeywordsPerPage?: number
}

export async function POST(req: NextRequest) {
  if (!verifyBearerAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body: BatchRequest = await req.json()
  const { domain, pages, skipLiveQueries = true, maxKeywordsPerPage = 3 } = body

  if (!domain || !pages?.length) {
    return NextResponse.json({ error: 'domain and pages are required' }, { status: 400 })
  }

  // Check daily spending cap
  const cap = await checkDailyCap()
  if (!cap.allowed) {
    return NextResponse.json({
      error: `Daily API spending cap reached ($${cap.spent.toFixed(2)}/$${cap.cap.toFixed(2)}). Try again tomorrow.`,
    }, { status: 429 })
  }

  // Extract keywords from page URLs
  const pageKeywordsMap = extractKeywordsForPages(pages, maxKeywordsPerPage)
  const keywords = Array.from(pageKeywordsMap.values()).flat()

  if (keywords.length === 0) {
    return NextResponse.json({ error: 'No keywords could be extracted from the provided pages' }, { status: 400 })
  }

  // Run analysis pipeline (reusing existing functions)
  const corePhrases = extractCorePhrases(keywords)
  const mentionKeywords = [...keywords, ...corePhrases]

  // Step 1: Google + ChatGPT mentions (batched)
  const googleResults: any[] = []
  const chatgptResults: any[] = []
  const mentionBatchSize = 5

  for (let i = 0; i < mentionKeywords.length; i += mentionBatchSize) {
    const batch = mentionKeywords.slice(i, i + mentionBatchSize)
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

  // Merge responses
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

  const googleMerged = mergeResponses(googleResults)
  const chatgptMerged = mergeResponses(chatgptResults)
  const googleMap = parseMentionSearch(googleMerged, domain, mentionKeywords)
  const chatgptMap = parseMentionSearch(chatgptMerged, domain, mentionKeywords)

  // Merge core phrases into parent keywords
  for (const core of corePhrases) {
    const coreLower = core.toLowerCase()
    const gCore = googleMap.get(coreLower)
    const cCore = chatgptMap.get(coreLower)
    const parent = keywords.find((kw) => {
      const kwWords = kw.toLowerCase().split(/\s+/)
      return core.toLowerCase().split(/\s+/).every((w) => kwWords.includes(w))
    })
    if (parent) {
      const parentLower = parent.toLowerCase()
      const gParent = googleMap.get(parentLower)
      const cParent = chatgptMap.get(parentLower)
      if (gCore && gParent) {
        for (const q of gCore.queries) {
          if (!gParent.queries.some((eq) => eq.question === q.question)) gParent.queries.push(q)
        }
        if (!gParent.aiSearchVolume && gCore.aiSearchVolume) gParent.aiSearchVolume = gCore.aiSearchVolume
        for (const s of gCore.allSources) {
          if (!gParent.allSources.find((es) => es.domain === s.domain)) gParent.allSources.push(s)
        }
      }
      if (cCore && cParent) {
        for (const q of cCore.queries) {
          if (!cParent.queries.some((eq) => eq.question === q.question)) cParent.queries.push(q)
        }
        for (const s of cCore.allSources) {
          if (!cParent.allSources.find((es) => es.domain === s.domain)) cParent.allSources.push(s)
        }
      }
    }
    googleMap.delete(coreLower)
    chatgptMap.delete(coreLower)
  }

  // Step 2: Perplexity + Claude (optional)
  const perplexityMap = new Map<string, PlatformResult>()
  const claudeMap = new Map<string, PlatformResult>()

  if (!skipLiveQueries) {
    const batchSize = 4
    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize)
      await Promise.all(
        batch.map((kw) =>
          fetchLlmResponse(kw, 'perplexity', LLM_MODELS.perplexity)
            .then((res) => perplexityMap.set(kw.toLowerCase(), parseLlmResponseResult(res, domain)))
            .catch(() => perplexityMap.set(kw.toLowerCase(), { found: false, position: null, snippet: null, citedUrls: [] }))
        )
      )
    }
    for (let i = 0; i < keywords.length; i += batchSize) {
      const batch = keywords.slice(i, i + batchSize)
      await Promise.all(
        batch.map((kw) =>
          fetchLlmResponse(kw, 'claude', LLM_MODELS.claude)
            .then((res) => claudeMap.set(kw.toLowerCase(), parseLlmResponseResult(res, domain)))
            .catch(() => claudeMap.set(kw.toLowerCase(), { found: false, position: null, snippet: null, citedUrls: [] }))
        )
      )
    }
  }

  // Compile results
  const rows = transformToRows(keywords, domain, {
    google: googleMap,
    chatgpt: chatgptMap,
    perplexity: perplexityMap,
    claude: claudeMap,
  })

  const googleCount = Array.from(googleMap.values()).filter((m) => m.domainFound).length
  const chatgptCount = Array.from(chatgptMap.values()).filter((m) => m.domainFound).length
  const perplexityCount = Array.from(perplexityMap.values()).filter((m) => m.found).length
  const claudeCount = Array.from(claudeMap.values()).filter((m) => m.found).length

  const summary = {
    domain,
    totalKeywords: keywords.length,
    googlePresent: googleCount,
    chatgptPresent: chatgptCount,
    perplexityPresent: perplexityCount,
    claudePresent: claudeCount,
    contentGaps: rows.filter((r) => r.content_gap).length,
  }

  const crawlMetadata = {
    period: 'week',
    fetchedAt: new Date().toISOString(),
    pages: pages.map((p) => ({
      path: p.path,
      hits: p.hits,
      bots: p.bots,
      keywords: pageKeywordsMap.get(p.path) || [],
    })),
  }

  // Store in Supabase — include source and crawl metadata in summary
  const { error: insertErr } = await supabase
    .from('analyses')
    .insert({
      email: 'system@progrowth.services',
      domain,
      keywords,
      summary: { ...summary, source: 'matomo-crawl', crawlMetadata },
      rows,
    })

  return NextResponse.json({
    domain,
    keywords,
    pageKeywords: Object.fromEntries(pageKeywordsMap),
    rows,
    summary,
    crawlMetadata,
  })
}
