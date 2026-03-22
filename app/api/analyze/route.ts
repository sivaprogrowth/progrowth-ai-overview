import { NextRequest } from 'next/server'
import {
  fetchMentionSearch,
  fetchLlmResponse,
  fetchRankedKeywords,
  filterDiscoveredKeywords,
  extractCorePhrases,
  LLM_MODELS,
} from '@/lib/dataforseo'
import {
  parseMentionSearch,
  parseLlmResponseResult,
  transformToRows,
  PlatformResult,
  parseDeepDiveMention,
  parseDeepDiveLlmResponse,
  DeepDivePlatformResponse,
  DeepDiveResult,
} from '@/lib/transform'
import { supabase } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

function getEmailFromSession(req: NextRequest): string | null {
  try {
    const token = req.cookies.get('session')?.value
    if (!token) return null
    const [data] = token.split('.')
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    return payload.email || null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const email = getEmailFromSession(req)
  const domain = req.nextUrl.searchParams.get('domain')?.trim()
  const keywordsParam = req.nextUrl.searchParams.get('keywords')?.trim()
  const mode = req.nextUrl.searchParams.get('mode') || 'keywords'

  if (mode !== 'deepdive' && !domain) {
    return new Response(JSON.stringify({ error: 'domain is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (mode === 'deepdive' && (!keywordsParam || keywordsParam.trim().length === 0)) {
    return new Response(JSON.stringify({ error: 'Query is required for deep dive' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (mode === 'keywords' && (!keywordsParam || keywordsParam.trim().length === 0)) {
    return new Response(JSON.stringify({ error: 'At least one keyword is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: any) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        )
      }

      try {
        // ── Deep Dive mode: fetch full AI responses for a single query ──
        if (mode === 'deepdive') {
          const query = keywordsParam!.trim()
          const platforms: DeepDivePlatformResponse[] = []

          send('progress', { step: 1, total: 4, message: 'Fetching Google AI Overview response...' })
          try {
            const res = await fetchMentionSearch(
              [{ keyword: query, match_type: 'partial_match' as const, search_scope: ['any' as const] }],
              'google', 10
            )
            platforms.push(parseDeepDiveMention(res, domain || null, 'google'))
          } catch {
            platforms.push({ platform: 'google', answer: '', sources: [], domainMentioned: false, error: 'Failed to fetch' })
          }

          send('progress', { step: 2, total: 4, message: 'Fetching ChatGPT response...' })
          try {
            const res = await fetchMentionSearch(
              [{ keyword: query, match_type: 'partial_match' as const, search_scope: ['any' as const] }],
              'chat_gpt', 10
            )
            platforms.push(parseDeepDiveMention(res, domain || null, 'chatgpt'))
          } catch {
            platforms.push({ platform: 'chatgpt', answer: '', sources: [], domainMentioned: false, error: 'Failed to fetch' })
          }

          send('progress', { step: 3, total: 4, message: 'Querying Perplexity live...' })
          try {
            const res = await fetchLlmResponse(query, 'perplexity', LLM_MODELS.perplexity, query)
            platforms.push(parseDeepDiveLlmResponse(res, domain || null, 'perplexity'))
          } catch {
            platforms.push({ platform: 'perplexity', answer: '', sources: [], domainMentioned: false, error: 'Failed to fetch' })
          }

          send('progress', { step: 4, total: 4, message: 'Querying Claude live...' })
          try {
            const res = await fetchLlmResponse(query, 'claude', LLM_MODELS.claude, query)
            platforms.push(parseDeepDiveLlmResponse(res, domain || null, 'claude'))
          } catch {
            platforms.push({ platform: 'claude', answer: '', sources: [], domainMentioned: false, error: 'Failed to fetch' })
          }

          const result: DeepDiveResult = { query, domain: domain || null, platforms }
          send('complete', { deepdive: result })
          controller.close()
          return
        }

        const isDiscovery = mode === 'discovery'
        const isBulk = mode === 'bulkcsv'
        const totalSteps = isDiscovery ? 5 : isBulk ? 2 : 4
        const stepOffset = isDiscovery ? 1 : 0
        let keywords: string[]

        if (isDiscovery) {
          // ── Step 1: Discover top keywords ──
          send('progress', {
            step: 1,
            total: totalSteps,
            message: `Discovering top keywords for ${domain}...`,
          })

          const rawKeywords = await fetchRankedKeywords(domain!, 20)
          keywords = filterDiscoveredKeywords(rawKeywords, domain!).slice(0, 8)

          if (keywords.length === 0) {
            send('error', { message: `No rankable keywords found for ${domain}. Try entering keywords manually.` })
            controller.close()
            return
          }

          send('progress', {
            step: 1,
            total: totalSteps,
            message: `Found ${keywords.length} keywords: ${keywords.slice(0, 3).join(', ')}${keywords.length > 3 ? '...' : ''}`,
          })
        } else {
          keywords = keywordsParam!
            .split('\n')
            .map((k) => k.trim())
            .filter(Boolean)

          if (keywords.length === 0) {
            send('error', { message: 'At least one keyword is required' })
            controller.close()
            return
          }
        }

        // ── Step 2 (or 1): LLM Mentions — Google AI Overviews + ChatGPT (per keyword) ──
        // Also search for broader core phrases to discover more queries
        const corePhrases = extractCorePhrases(keywords)
        const mentionKeywords = [...keywords, ...corePhrases]

        send('progress', {
          step: 1 + stepOffset,
          total: totalSteps,
          message: `Scanning Google AI Overviews & ChatGPT for ${mentionKeywords.length} terms (${keywords.length} keywords + ${corePhrases.length} core phrases)...`,
        })

        // Call per keyword to avoid AND-logic issue with multi-target requests
        const googleResults: any[] = []
        const chatgptResults: any[] = []
        const mentionBatchSize = 5
        for (let i = 0; i < mentionKeywords.length; i += mentionBatchSize) {
          const batch = mentionKeywords.slice(i, i + mentionBatchSize)
          send('progress', {
            step: 1 + stepOffset,
            total: totalSteps,
            message: `Google + ChatGPT (${Math.min(i + mentionBatchSize, mentionKeywords.length)}/${mentionKeywords.length})...`,
          })

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

        // Merge per-keyword results: combine all responses into one fake bulk response per platform
        function mergeResponses(responses: any[]): any {
          const allItems: any[] = []
          for (const res of responses) {
            const tasks = res?.tasks || []
            for (const task of tasks) {
              const results = task?.result || []
              for (const result of results) {
                allItems.push(...(result?.items || []))
              }
            }
          }
          if (allItems.length === 0) return null
          return { tasks: [{ result: [{ items: allItems }] }] }
        }

        const googleMerged = mergeResponses(googleResults)
        const chatgptMerged = mergeResponses(chatgptResults)
        // Parse with all mentionKeywords so core phrase queries get assigned to closest original keyword
        const googleMap = parseMentionSearch(googleMerged, domain!, mentionKeywords)
        const chatgptMap = parseMentionSearch(chatgptMerged, domain!, mentionKeywords)
        // Merge core phrase results into their parent keywords
        for (const core of corePhrases) {
          const coreLower = core.toLowerCase()
          const gCore = googleMap.get(coreLower)
          const cCore = chatgptMap.get(coreLower)
          // Find the original keyword this core came from
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
          // Remove core phrase keys from maps (only keep original keywords)
          googleMap.delete(coreLower)
          chatgptMap.delete(coreLower)
        }

        const googleCount = Array.from(googleMap.values()).filter((m) => m.domainFound).length
        const chatgptCount = Array.from(chatgptMap.values()).filter((m) => m.domainFound).length

        send('progress', {
          step: 1 + stepOffset,
          total: totalSteps,
          message: `Google AI Overviews: ${googleCount}/${keywords.length} | ChatGPT: ${chatgptCount}/${keywords.length}`,
        })

        const perplexityMap = new Map<string, PlatformResult>()
        const claudeMap = new Map<string, PlatformResult>()
        let perplexityCount = 0
        let claudeCount = 0

        if (!isBulk) {
          // ── Step 3 (or 2): Perplexity (live queries) ──
          send('progress', {
            step: 2 + stepOffset,
            total: totalSteps,
            message: `Querying Perplexity for ${keywords.length} keywords...`,
          })

          const batchSize = 4
          for (let i = 0; i < keywords.length; i += batchSize) {
            const batch = keywords.slice(i, i + batchSize)
            send('progress', {
              step: 2 + stepOffset,
              total: totalSteps,
              message: `Perplexity (${Math.min(i + batchSize, keywords.length)}/${keywords.length})...`,
            })

            await Promise.all(
              batch.map((kw) =>
                fetchLlmResponse(kw, 'perplexity', LLM_MODELS.perplexity)
                  .then((res) => {
                    perplexityMap.set(kw.toLowerCase(), parseLlmResponseResult(res, domain!))
                  })
                  .catch(() => {
                    perplexityMap.set(kw.toLowerCase(), { found: false, position: null, snippet: null, citedUrls: [] })
                  })
              )
            )
          }

          perplexityCount = Array.from(perplexityMap.values()).filter((m) => m.found).length
          send('progress', {
            step: 2 + stepOffset,
            total: totalSteps,
            message: `Perplexity: ${perplexityCount}/${keywords.length}`,
          })

          // ── Step 4 (or 3): Claude (live queries) ──
          send('progress', {
            step: 3 + stepOffset,
            total: totalSteps,
            message: `Querying Claude for ${keywords.length} keywords...`,
          })

          for (let i = 0; i < keywords.length; i += batchSize) {
            const batch = keywords.slice(i, i + batchSize)
            send('progress', {
              step: 3 + stepOffset,
              total: totalSteps,
              message: `Claude (${Math.min(i + batchSize, keywords.length)}/${keywords.length})...`,
            })

            await Promise.all(
              batch.map((kw) =>
                fetchLlmResponse(kw, 'claude', LLM_MODELS.claude)
                  .then((res) => {
                    claudeMap.set(kw.toLowerCase(), parseLlmResponseResult(res, domain!))
                  })
                  .catch(() => {
                    claudeMap.set(kw.toLowerCase(), { found: false, position: null, snippet: null, citedUrls: [] })
                  })
              )
            )
          }

          claudeCount = Array.from(claudeMap.values()).filter((m) => m.found).length
          send('progress', {
            step: 3 + stepOffset,
            total: totalSteps,
            message: `Claude: ${claudeCount}/${keywords.length}`,
          })
        }

        // ── Compile results ──
        const compileStep = isBulk ? 2 : 4 + stepOffset
        send('progress', {
          step: compileStep,
          total: totalSteps,
          message: 'Compiling results...',
        })

        const rows = transformToRows(keywords, domain!, {
          google: googleMap,
          chatgpt: chatgptMap,
          perplexity: perplexityMap,
          claude: claudeMap,
        })

        const summary = {
          domain,
          totalKeywords: keywords.length,
          googlePresent: googleCount,
          chatgptPresent: chatgptCount,
          perplexityPresent: perplexityCount,
          claudePresent: claudeCount,
          contentGaps: rows.filter((r) => r.content_gap).length,
        }

        send('complete', { rows, summary })

        // Fire-and-forget: store analysis in Supabase
        if (email) {
          supabase
            .from('analyses')
            .insert({
              email,
              domain,
              keywords,
              summary,
              rows,
            })
            .then(({ error: insertErr }) => {
              if (insertErr) console.error('Failed to store analysis:', insertErr)
            })
        }
      } catch (error: any) {
        send('error', { message: error.message || 'Analysis failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
