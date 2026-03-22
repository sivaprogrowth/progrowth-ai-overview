import { NextRequest } from 'next/server'
import {
  fetchMentionSearch,
  fetchLlmResponse,
  LLM_MODELS,
} from '@/lib/dataforseo'
import {
  parseMentionSearch,
  parseLlmResponseResult,
  transformToRows,
  PlatformResult,
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

  if (!domain || !keywordsParam) {
    return new Response(JSON.stringify({ error: 'domain and keywords are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const keywords = keywordsParam
    .split('\n')
    .map((k) => k.trim())
    .filter(Boolean)

  if (keywords.length === 0) {
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
        // Build keyword targets for LLM Mentions API
        const keywordTargets = keywords.map((kw) => ({
          keyword: kw,
          match_type: 'partial_match' as const,
          search_scope: ['any' as const],
        }))

        // ── Step 1: LLM Mentions — Google AI Overviews + ChatGPT (bulk, fast) ──
        send('progress', {
          step: 1,
          total: 4,
          message: `Scanning Google AI Overviews & ChatGPT for ${keywords.length} keywords (bulk)...`,
        })

        const [googleRes, chatgptRes] = await Promise.all([
          fetchMentionSearch(keywordTargets, 'google', 200).catch((e) => {
            send('progress', { step: 1, total: 4, message: `Google API error: ${e.message}` })
            return null
          }),
          fetchMentionSearch(keywordTargets, 'chat_gpt', 200).catch((e) => {
            send('progress', { step: 1, total: 4, message: `ChatGPT API error: ${e.message}` })
            return null
          }),
        ])

        const googleMap = parseMentionSearch(googleRes, domain, keywords)
        const chatgptMap = parseMentionSearch(chatgptRes, domain, keywords)

        const googleCount = Array.from(googleMap.values()).filter((m) => m.domainFound).length
        const chatgptCount = Array.from(chatgptMap.values()).filter((m) => m.domainFound).length

        send('progress', {
          step: 1,
          total: 4,
          message: `Google AI Overviews: ${googleCount}/${keywords.length} | ChatGPT: ${chatgptCount}/${keywords.length}`,
        })

        // ── Step 2: Perplexity (live queries) ──
        send('progress', {
          step: 2,
          total: 4,
          message: `Querying Perplexity for ${keywords.length} keywords...`,
        })

        const perplexityMap = new Map<string, PlatformResult>()
        const batchSize = 3
        for (let i = 0; i < keywords.length; i += batchSize) {
          const batch = keywords.slice(i, i + batchSize)
          send('progress', {
            step: 2,
            total: 4,
            message: `Perplexity (${Math.min(i + batchSize, keywords.length)}/${keywords.length})...`,
          })

          await Promise.all(
            batch.map((kw) =>
              fetchLlmResponse(kw, 'perplexity', LLM_MODELS.perplexity)
                .then((res) => {
                  perplexityMap.set(kw.toLowerCase(), parseLlmResponseResult(res, domain))
                })
                .catch(() => {
                  perplexityMap.set(kw.toLowerCase(), { found: false, position: null, snippet: null, citedUrls: [] })
                })
            )
          )
        }

        const perplexityCount = Array.from(perplexityMap.values()).filter((m) => m.found).length
        send('progress', {
          step: 2,
          total: 4,
          message: `Perplexity: ${perplexityCount}/${keywords.length}`,
        })

        // ── Step 3: Claude (live queries) ──
        send('progress', {
          step: 3,
          total: 4,
          message: `Querying Claude for ${keywords.length} keywords...`,
        })

        const claudeMap = new Map<string, PlatformResult>()
        for (let i = 0; i < keywords.length; i += batchSize) {
          const batch = keywords.slice(i, i + batchSize)
          send('progress', {
            step: 3,
            total: 4,
            message: `Claude (${Math.min(i + batchSize, keywords.length)}/${keywords.length})...`,
          })

          await Promise.all(
            batch.map((kw) =>
              fetchLlmResponse(kw, 'claude', LLM_MODELS.claude)
                .then((res) => {
                  claudeMap.set(kw.toLowerCase(), parseLlmResponseResult(res, domain))
                })
                .catch(() => {
                  claudeMap.set(kw.toLowerCase(), { found: false, position: null, snippet: null, citedUrls: [] })
                })
            )
          )
        }

        const claudeCount = Array.from(claudeMap.values()).filter((m) => m.found).length
        send('progress', {
          step: 3,
          total: 4,
          message: `Claude: ${claudeCount}/${keywords.length}`,
        })

        // ── Step 4: Compile results ──
        send('progress', {
          step: 4,
          total: 4,
          message: 'Compiling results...',
        })

        const rows = transformToRows(keywords, domain, {
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
