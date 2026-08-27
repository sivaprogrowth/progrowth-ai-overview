/**
 * Grader adapter over the shared DataForSEO client.
 *
 * This is the ONLY module in lib/grader that talks to lib/dataforseo.ts.
 * Everything downstream of it works with `EngineAnswer` — nobody else
 * touches a raw DataForSEO response shape, cost field, or task envelope.
 *
 * Account-tier constraint (see AUDIT.md): llm_mentions/* returns 40204
 * "Access denied" on this account (already documented in lib/geoSeoGap.ts
 * and lib/dataforseo.ts). The three endpoints proven to work — chat_gpt,
 * perplexity and claude llm_responses/live — are the grader's three answer
 * engines. Google AI Overviews is intentionally NOT one of them for Phase 1.
 *
 * Every call already goes through lib/dataforseo.ts's dfsPost, so the
 * grader inherits, for free: Basic-auth, the 90s per-call timeout, the
 * task-status_code failure check, and cost logging into api_cost_log
 * (shared with the internal product's daily spend cap — grader runs count
 * against the SAME cap, which is the intended "one bank account" model for
 * Phase 1).
 */

import {
  fetchChatgptLlmResponse,
  fetchLlmResponse,
  LLM_MODELS,
  DataForSeoCapExceededError,
} from '../dataforseo'
import { extractBrandCandidates } from './competitors'
import type { BrandMatcher } from './brand-matcher'
import type { CitationRef, EngineAnswer, GraderEngine } from './types'

/** Non-content annotation targets DataForSEO/vertex sometimes injects. */
function isRealCitationUrl(url: string): boolean {
  return !!url && !url.includes('vertexaisearch.cloud.google.com')
}

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Both chat_gpt/llm_responses and perplexity|claude/llm_responses share this
 * envelope shape: tasks[0].result[0].items[0].sections[].{text,annotations}.
 */
function extractSectionsPayload(raw: any): { text: string; citations: CitationRef[] } {
  const result = raw?.tasks?.[0]?.result?.[0]
  const item = result?.items?.[0]
  const sections: any[] = item?.sections ?? []
  const text = sections.map((s) => s?.text ?? '').join('\n').trim()

  const seen = new Set<string>()
  const citations: CitationRef[] = []
  for (const section of sections) {
    for (const ann of section?.annotations ?? []) {
      if (!ann?.url || !isRealCitationUrl(ann.url)) continue
      const domain = extractDomain(ann.url)
      if (!domain || seen.has(ann.url)) continue
      seen.add(ann.url)
      citations.push({ domain, url: ann.url, title: ann.title ?? null })
    }
  }
  return { text, citations }
}

/** Fetch one (query, engine) answer and normalise it. Never throws. */
export async function fetchGraderAnswer(
  query: string,
  engine: GraderEngine,
  matcher: BrandMatcher
): Promise<EngineAnswer> {
  const empty: EngineAnswer = {
    query,
    engine,
    answerText: '',
    brandMentioned: false,
    brandPosition: null,
    competitors: [],
    citations: [],
    costUsd: null,
    error: null,
  }

  try {
    const raw =
      engine === 'chatgpt'
        ? await fetchChatgptLlmResponse(
            `What are the best companies for "${query}"? List specific company names, their websites, and briefly explain why each is recommended.`,
            { webSearch: true }
          )
        : await fetchLlmResponse(query, engine, LLM_MODELS[engine])

    const { text, citations } = extractSectionsPayload(raw)
    const costUsd = typeof raw?.cost === 'number' ? raw.cost : null
    if (!text && citations.length === 0) {
      return { ...empty, costUsd, error: 'provider returned an empty answer' }
    }

    const mentionedInText = matcher.mentionedIn(text)
    const citedDomains: string[] = []
    for (const c of citations) if (!citedDomains.includes(c.domain)) citedDomains.push(c.domain)
    const positionIdx = citedDomains.findIndex((d) => matcher.ownsDomain(d))
    const brandMentioned = mentionedInText || positionIdx >= 0

    return {
      query,
      engine,
      answerText: text,
      brandMentioned,
      brandPosition: positionIdx >= 0 ? positionIdx + 1 : null,
      competitors: extractBrandCandidates(text, citations, matcher),
      citations,
      costUsd,
      error: null,
    }
  } catch (e) {
    if (e instanceof DataForSeoCapExceededError) {
      return { ...empty, error: `daily spend cap reached ($${e.spent.toFixed(2)}/$${e.cap})` }
    }
    return { ...empty, error: e instanceof Error ? e.message : 'provider call failed' }
  }
}

/** All three answer engines the grader queries for Phase 1. */
export const GRADER_ENGINES: GraderEngine[] = ['chatgpt', 'perplexity', 'claude']

/**
 * Fetch every (query, engine) pair with bounded concurrency and an overall
 * wall-clock deadline. Each pair is independently caught inside
 * fetchGraderAnswer, so one dead engine never takes another query down with
 * it — the caller always gets one EngineAnswer per pair, success, provider
 * failure, or (once the deadline passes) a synthetic timeout failure.
 *
 * The deadline exists because the runner route has its own hard ceiling
 * (Vercel `maxDuration`, see app/api/grader/run/route.ts) — if the
 * per-call 90s timeouts in lib/dataforseo.ts were allowed to run out the
 * clock, the function would be killed mid-flight and the run would never
 * get persisted at all (stuck at 'processing' forever, worse than a
 * partial report). When the deadline fires, in-flight calls are left to
 * settle in the background (they cannot be cancelled — DataForSEO may
 * still bill them) and every pair that hasn't produced a result yet is
 * filled with a timeout EngineAnswer so the array stays complete.
 */
export async function fetchAllGraderAnswers(
  queries: string[],
  matcher: BrandMatcher,
  opts: { concurrency?: number; engines?: GraderEngine[]; deadlineMs?: number } = {}
): Promise<EngineAnswer[]> {
  const engines = opts.engines ?? GRADER_ENGINES
  const pairs: Array<{ query: string; engine: GraderEngine }> = []
  for (const query of queries) for (const engine of engines) pairs.push({ query, engine })

  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const results: EngineAnswer[] = new Array(pairs.length)
  const settled: boolean[] = new Array(pairs.length).fill(false)
  let cursor = 0
  let deadlineHit = false

  async function worker() {
    while (!deadlineHit) {
      const i = cursor++
      if (i >= pairs.length) return
      results[i] = await fetchGraderAnswer(pairs[i].query, pairs[i].engine, matcher)
      settled[i] = true
    }
  }

  const work = Promise.all(Array.from({ length: Math.min(concurrency, pairs.length) }, worker))
  const deadlineMs = opts.deadlineMs
  if (deadlineMs && deadlineMs > 0) {
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, deadlineMs))])
    deadlineHit = true
  } else {
    await work
  }

  for (let i = 0; i < pairs.length; i++) {
    if (settled[i]) continue
    results[i] = {
      query: pairs[i].query,
      engine: pairs[i].engine,
      answerText: '',
      brandMentioned: false,
      brandPosition: null,
      competitors: [],
      citations: [],
      costUsd: null,
      error: 'analysis deadline reached before this call completed',
    }
  }

  return results
}
