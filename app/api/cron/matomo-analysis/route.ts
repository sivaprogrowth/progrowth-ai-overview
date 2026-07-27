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
/**
 * 300s, not 60s — the platform maximum, and still not comfortably enough.
 *
 * The mention-search loop runs sequential batches of live DataForSEO calls
 * whose measured latency is ~7-32s each (median ~17s), and the DB insert is
 * the last statement in the route. So an overrun costs the full spend and
 * writes nothing. At 60s this route died every Monday from 2026-06-29 while
 * burning ~$11.60 per killed attempt.
 *
 * Raising this was necessary but NOT sufficient: a 300s run still died,
 * because nothing bounded an individual call or the loop as a whole. Those
 * are handled by DFS_CALL_TIMEOUT_MS and PROVIDER_DEADLINE_MS respectively.
 *
 * vercel.json pins this route's maxDuration independently; both must say
 * 300 or the lower one wins.
 */
export const maxDuration = 300

/**
 * Cost ceiling, not a time ceiling. Every call is billed (~$0.20; even a
 * 19-item response cost $0.119), so N keywords = 2N calls = ~$0.40N.
 * 40 keywords caps a run at roughly $16. Time is governed by
 * PROVIDER_DEADLINE_MS below, which will usually bind first.
 */
const MAX_MENTION_KEYWORDS = 40

/**
 * Wall-clock budget for the mention-search loop, inside maxDuration=300.
 *
 * THE STRUCTURAL PROBLEM: at a measured ~17s median per call and 2 calls
 * per keyword, a full 36-keyword run needs 2-4 minutes of provider time
 * even at this concurrency — against a hard 300s platform ceiling, with
 * the DB write at the very end. There is no timeout value that makes
 * "check every keyword, then write" fit reliably. So the loop now stops
 * itself at a deadline and reports what it did not reach, instead of
 * being killed mid-flight and reporting nothing.
 *
 * 210s leaves ~90s for the Matomo fetch, transform and insert. A run that
 * hits this deadline is a PARTIAL run and says so — see keywordsUnchecked.
 *
 * Coverage is completed ACROSS runs, not within one: the rotation below
 * puts last run's unchecked keywords at the front of this run's queue, so
 * the deadline truncates a different tail each week instead of the same one
 * forever. Every keyword gets checked; it just takes a few runs.
 */
const PROVIDER_DEADLINE_MS = 210_000

/**
 * 1 keyword = 2 concurrent calls (google + chat_gpt for the same term).
 *
 * MEASURED 2026-07-27, and the reason coverage was so bad: six CONCURRENT
 * llm_mentions calls returned three `50000` internal-error tasks — HTTP 200,
 * zero items, $0 — after ~50s each. The same six keywords run SEQUENTIALLY
 * were 6/6 Ok. Concurrency does not merely lengthen the tail on this
 * endpoint, it makes the provider fail requests outright, and each failure
 * burns ~50s of the budget for nothing.
 *
 * So parallelism here is negative-value beyond the platform pair. Fewer
 * calls in flight completes MORE keywords per minute, not fewer.
 */
const BATCH_SIZE = 1

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

  // ROTATION: carry last run's misses to the front of this run's queue.
  //
  // A single request cannot check every keyword — the provider needs ~17s per
  // call, two calls per keyword, and concurrency makes it fail rather than go
  // faster (see BATCH_SIZE). Without rotation the deadline always truncates
  // the SAME tail of the list, so those keywords are never checked in any
  // week, however many times the cron runs. Prioritising last week's
  // unchecked keywords makes coverage complete ACROSS runs instead of
  // permanently partial within one.
  const { data: priorRun } = await supabase
    .from('analyses')
    .select('summary')
    .eq('client_id', client.id)
    .eq('summary->>source', 'matomo-crawl')
    .order('created_at', { ascending: false })
    .limit(1)
  const priorUnchecked: string[] = (() => {
    const raw = (priorRun?.[0]?.summary as { crawlMetadata?: { keywordsUnchecked?: unknown } } | undefined)
      ?.crawlMetadata?.keywordsUnchecked
    return Array.isArray(raw) ? raw.map((k) => String(k)) : []
  })()
  const carriedOver = keywords.filter((kw) => priorUnchecked.includes(kw))
  const freshKeywords = keywords.filter((kw) => !priorUnchecked.includes(kw))
  if (carriedOver.length > 0) {
    console.log(
      `[matomo-analysis] ${client.slug}: carrying ${carriedOver.length} keyword(s) unchecked last run to the front: ${carriedOver.join(', ')}`
    )
  }

  // Core phrases last: they are merged into their parent keyword after
  // parsing and then discarded, so they are an enrichment, never the point.
  // Spending the deadline on them while a real keyword goes unchecked is
  // backwards.
  const corePhrases = extractCorePhrases(keywords)
  const allMentionKeywords = [...carriedOver, ...freshKeywords, ...corePhrases]
  const mentionKeywords = allMentionKeywords.slice(0, MAX_MENTION_KEYWORDS)
  const droppedKeywords = allMentionKeywords.slice(MAX_MENTION_KEYWORDS)
  if (droppedKeywords.length > 0) {
    console.warn(
      `[matomo-analysis] ${client.slug}: capped at ${MAX_MENTION_KEYWORDS} mention keywords, ` +
        `dropped ${droppedKeywords.length}: ${droppedKeywords.join(', ')}`
    )
  }

  const googleResults: any[] = []
  const chatgptResults: any[] = []

  // A keyword is CHECKED only if at least one of its two calls actually
  // returned. Anything else — aborted, errored, or never attempted because
  // the deadline hit — is unchecked, and must not be reported as "the brand
  // was not mentioned". That conflation is why three empty runs and one
  // 46%-complete run all looked like clean successes.
  const checkedKeywords = new Set<string>()
  const failedKeywords: string[] = []
  const callErrors: string[] = []
  const loopStartedAt = Date.now()
  let deadlineHit = false
  let unattempted: string[] = []

  for (let i = 0; i < mentionKeywords.length; i += BATCH_SIZE) {
    const elapsed = Date.now() - loopStartedAt
    if (elapsed > PROVIDER_DEADLINE_MS) {
      deadlineHit = true
      unattempted = mentionKeywords.slice(i)
      console.warn(
        `[matomo-analysis] ${client.slug}: provider deadline hit after ${Math.round(elapsed / 1000)}s — ` +
          `${unattempted.length} keywords not attempted: ${unattempted.join(', ')}`
      )
      break
    }

    const batch = mentionKeywords.slice(i, i + BATCH_SIZE)
    // Record the reason a call failed instead of erasing it. The old
    // `.catch(() => null)` made an aborted call indistinguishable from a
    // genuine "no mentions found", which left every failure invisible.
    const call = (kw: string, platform: 'google' | 'chat_gpt') => {
      const target = [{ keyword: kw, match_type: 'partial_match' as const, search_scope: ['any' as const] }]
      return fetchMentionSearch(target, platform, 100).catch((err: unknown) => {
        const name = (err as { name?: string })?.name
        const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : String(err).slice(0, 120)
        callErrors.push(`${platform}:${kw}:${reason}`)
        return null
      })
    }

    const calls = batch.flatMap((kw) => [call(kw, 'google'), call(kw, 'chat_gpt')])
    const results = await Promise.all(calls)
    for (let j = 0; j < batch.length; j++) {
      const g = results[j * 2]
      const c = results[j * 2 + 1]
      googleResults.push(g)
      chatgptResults.push(c)
      if (g !== null || c !== null) checkedKeywords.add(batch[j])
      else failedKeywords.push(batch[j])
    }
  }

  if (callErrors.length > 0) {
    console.warn(
      `[matomo-analysis] ${client.slug}: ${callErrors.length} provider calls failed — ${callErrors.join(' | ')}`
    )
  }

  // Only keywords we actually checked may carry a verdict. The rest are
  // reported separately so a partial run can never read as a full one.
  const analysedKeywords = keywords.filter((kw) => checkedKeywords.has(kw))
  const uncheckedKeywords = keywords.filter((kw) => !checkedKeywords.has(kw))

  if (analysedKeywords.length === 0) {
    // Nothing was verified: writing a row here would publish "no mentions
    // anywhere" as a finding. Fail loudly instead.
    return NextResponse.json(
      {
        error: 'No provider calls succeeded — refusing to write a row that would read as zero mentions.',
        keywords: keywords.length,
        failedCalls: callErrors.length,
        sampleErrors: callErrors.slice(0, 5),
      },
      { status: 502 }
    )
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

  // analysedKeywords, NOT keywords — an unchecked keyword gets no row at
  // all rather than a row asserting the brand was absent.
  const rows = transformToRows(analysedKeywords, domain, {
    google: googleMap,
    chatgpt: chatgptMap,
    perplexity: new Map<string, PlatformResult>(),
    claude: new Map<string, PlatformResult>(),
  }, client.competitor_sites)

  const summary = {
    domain,
    totalKeywords: keywords.length,
    keywordsChecked: analysedKeywords.length,
    keywordsUnchecked: uncheckedKeywords.length,
    coverageComplete: uncheckedKeywords.length === 0 && !deadlineHit,
    googlePresent: Array.from(googleMap.values()).filter((m) => m.domainFound).length,
    chatgptPresent: Array.from(chatgptMap.values()).filter((m) => m.domainFound).length,
    perplexityPresent: 0,
    claudePresent: 0,
    contentGaps: rows.filter((r) => r.content_gap).length,
  }

  const crawlMetadata = {
    period: 'week',
    fetchedAt: new Date().toISOString(),
    // Recorded so a partial run is never mistaken for full coverage.
    mentionKeywordsAnalysed: mentionKeywords.length,
    mentionKeywordsDropped: droppedKeywords,
    keywordsUnchecked: uncheckedKeywords,
    keywordsCarriedIn: carriedOver,
    keywordsFailed: failedKeywords,
    keywordsUnattempted: unattempted,
    deadlineHit,
    failedCallCount: callErrors.length,
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
    message: deadlineHit || uncheckedKeywords.length > 0
      ? 'Matomo crawl analysis completed — PARTIAL coverage'
      : 'Matomo crawl analysis completed',
    crawledPages: crawledPages.length,
    keywords: keywords.length,
    keywordsChecked: analysedKeywords.length,
    keywordsUnchecked: uncheckedKeywords.length,
    deadlineHit,
    failedCallCount: callErrors.length,
    mentionKeywordsAnalysed: mentionKeywords.length,
    mentionKeywordsDropped: droppedKeywords.length,
    summary,
  })
}
