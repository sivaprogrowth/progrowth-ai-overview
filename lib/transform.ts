export interface MentionRow {
  keyword: string
  ai_search_volume: number | null
  google_ai_overview: boolean
  chatgpt_mentioned: boolean
  perplexity_mentioned: boolean
  claude_mentioned: boolean
  platforms_present: number
  your_page_url: string | null
  your_mention_position: number | null
  competitor_1_domain: string | null
  competitor_1_page_url: string | null
  competitor_2_domain: string | null
  competitor_2_page_url: string | null
  competitor_3_domain: string | null
  competitor_3_page_url: string | null
  content_gap: boolean
  context_snippet: string | null
  queries: Array<{ question: string; volume: number | null }>
}

export interface PlatformResult {
  found: boolean
  position: number | null
  snippet: string | null
  citedUrls: CitedUrl[]
}

export interface CitedUrl {
  domain: string
  url: string
  title: string | null
}

export interface MentionSearchItem {
  question: string
  answer: string
  ai_search_volume: number | null
  sources: Array<{
    domain: string
    url: string
    title: string | null
    snippet: string | null
    source_name: string | null
  }>
}

// ── Main transform function ──

export function transformToRows(
  keywords: string[],
  domain: string,
  data: {
    google: Map<string, MentionKeywordResult>
    chatgpt: Map<string, MentionKeywordResult>
    perplexity: Map<string, PlatformResult>
    claude: Map<string, PlatformResult>
  },
  /** Configured competitor domains — when cited they are prioritised
   *  (in this order) into the competitor_1/2/3 slots ahead of the
   *  generic any-non-brand fill. Empty = legacy auto-derived behaviour. */
  competitorSites: string[] = []
): MentionRow[] {
  const domainLower = domain.toLowerCase().replace(/^www\./, '')
  const configuredCompetitors = competitorSites
    .map((c) => c.toLowerCase().replace(/^www\./, ''))
    .filter(Boolean)

  return keywords.map((kw) => {
    const kwLower = kw.toLowerCase()
    const google = data.google.get(kwLower)
    const chatgpt = data.chatgpt.get(kwLower)
    const perplexity = data.perplexity.get(kwLower) || emptyPlatform()
    const claude = data.claude.get(kwLower) || emptyPlatform()

    const googleFound = google?.domainFound ?? false
    const chatgptFound = chatgpt?.domainFound ?? false

    const platforms = [googleFound, chatgptFound, perplexity.found, claude.found].filter(Boolean).length

    // Find your page URL from any platform
    const yourPageUrl =
      google?.yourPageUrl || chatgpt?.yourPageUrl ||
      findYourUrl(perplexity.citedUrls, domainLower) ||
      findYourUrl(claude.citedUrls, domainLower)

    const yourPosition = google?.yourPosition || chatgpt?.yourPosition || perplexity.position || claude.position

    // AI search volume (prefer from mentions API — richer data)
    const aiVolume = google?.aiSearchVolume ?? chatgpt?.aiSearchVolume ?? null

    // Snippet
    const snippet = google?.snippet || chatgpt?.snippet || perplexity.snippet || claude.snippet

    // Collect competitors from all platforms
    const allCompetitors = new Map<string, CitedUrl>()
    for (const source of google?.allSources || []) {
      if (!isDomainMatch(source.domain, domainLower) && !allCompetitors.has(source.domain)) {
        allCompetitors.set(source.domain, { domain: source.domain, url: source.url, title: source.title })
      }
    }
    for (const source of chatgpt?.allSources || []) {
      if (!isDomainMatch(source.domain, domainLower) && !allCompetitors.has(source.domain)) {
        allCompetitors.set(source.domain, { domain: source.domain, url: source.url, title: source.title })
      }
    }
    for (const cited of [...perplexity.citedUrls, ...claude.citedUrls]) {
      if (!isDomainMatch(cited.domain, domainLower) && !allCompetitors.has(cited.domain)) {
        allCompetitors.set(cited.domain, cited)
      }
    }

    // Prioritise configured competitors (in configured order, only when
    // actually cited) ahead of the generic non-brand fill.
    const allComp = Array.from(allCompetitors.values())
    const ordered = [
      ...configuredCompetitors.flatMap((c) =>
        allComp.filter((x) => isDomainMatch(x.domain, c))
      ),
      ...allComp.filter(
        (x) => !configuredCompetitors.some((c) => isDomainMatch(x.domain, c))
      ),
    ]
    const seenComp = new Set<string>()
    const top3: CitedUrl[] = []
    for (const x of ordered) {
      if (seenComp.has(x.domain)) continue
      seenComp.add(x.domain)
      top3.push(x)
      if (top3.length === 3) break
    }
    const contentGap = platforms === 0 && top3.length > 0

    // Collect unique queries from Google and ChatGPT mentions, sorted by AI volume
    const queryMap = new Map<string, number | null>()
    for (const q of [...(google?.queries || []), ...(chatgpt?.queries || [])]) {
      const existing = queryMap.get(q.question)
      if (existing === undefined) {
        queryMap.set(q.question, q.volume)
      } else if (q.volume && (!existing || q.volume > existing)) {
        queryMap.set(q.question, q.volume)
      }
    }
    const queries = Array.from(queryMap.entries())
      .map(([question, volume]) => ({ question, volume }))
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))

    return {
      keyword: kw,
      ai_search_volume: aiVolume,
      google_ai_overview: googleFound,
      chatgpt_mentioned: chatgptFound,
      perplexity_mentioned: perplexity.found,
      claude_mentioned: claude.found,
      platforms_present: platforms,
      your_page_url: yourPageUrl,
      your_mention_position: yourPosition,
      competitor_1_domain: top3[0]?.domain ?? null,
      competitor_1_page_url: top3[0]?.url ?? null,
      competitor_2_domain: top3[1]?.domain ?? null,
      competitor_2_page_url: top3[1]?.url ?? null,
      competitor_3_domain: top3[2]?.domain ?? null,
      competitor_3_page_url: top3[2]?.url ?? null,
      content_gap: contentGap,
      context_snippet: snippet ? snippet.slice(0, 200) : null,
      queries,
    }
  })
}

// ── LLM Mentions API response parsing ──

export interface MentionKeywordResult {
  domainFound: boolean
  yourPageUrl: string | null
  yourPosition: number | null
  aiSearchVolume: number | null
  snippet: string | null
  allSources: Array<{ domain: string; url: string; title: string | null }>
  queries: Array<{ question: string; volume: number | null }>
}

export function parseMentionSearch(
  response: any,
  domain: string,
  keywords: string[]
): Map<string, MentionKeywordResult> {
  const map = new Map<string, MentionKeywordResult>()
  const domainLower = domain.toLowerCase().replace(/^www\./, '')

  // Initialize all keywords with empty results
  for (const kw of keywords) {
    map.set(kw.toLowerCase(), {
      domainFound: false,
      yourPageUrl: null,
      yourPosition: null,
      aiSearchVolume: null,
      snippet: null,
      allSources: [],
      queries: [],
    })
  }

  try {
    const tasks = response?.tasks || []
    for (const task of tasks) {
      const results = task?.result || []
      for (const result of results) {
        const items = result?.items || []
        for (const item of items) {
          const question = (item?.question || '').toLowerCase()

          // Match item to closest keyword
          const matchedKw = findClosestKeyword(question, keywords)
          if (!matchedKw) {
            // If no match, try to assign to any keyword that partially overlaps
            const fallback = keywords.find((kw) => {
              const kwWords = kw.toLowerCase().split(/\s+/)
              return kwWords.every((w) => question.includes(w))
            })
            if (!fallback) continue
            const existing2 = map.get(fallback.toLowerCase())!
            if (item.question && !existing2.queries.some((q) => q.question === item.question)) {
              existing2.queries.push({ question: item.question, volume: item.ai_search_volume || null })
            }
            if (item.ai_search_volume && (!existing2.aiSearchVolume || item.ai_search_volume > existing2.aiSearchVolume)) {
              existing2.aiSearchVolume = item.ai_search_volume
            }
            for (const s of (item.sources || []).map((s: any) => ({
              domain: (s.domain || '').toLowerCase().replace(/^www\./, ''),
              url: s.url || '',
              title: s.title || s.source_name || null,
            }))) {
              if (s.domain && !existing2.allSources.find((es: any) => es.domain === s.domain)) {
                existing2.allSources.push(s)
              }
            }
            continue
          }

          const existing = map.get(matchedKw.toLowerCase())!
          if (item.question && !existing.queries.some((q) => q.question === item.question)) {
            existing.queries.push({ question: item.question, volume: item.ai_search_volume || null })
          }
          const sources: Array<{ domain: string; url: string; title: string | null }> = (item.sources || []).map((s: any) => ({
            domain: (s.domain || '').toLowerCase().replace(/^www\./, ''),
            url: s.url || '',
            title: s.title || s.source_name || null,
          }))

          // Check if our domain appears in sources
          const domainIdx = sources.findIndex((s) => isDomainMatch(s.domain, domainLower))
          const domainInAnswer = (item.answer || '').toLowerCase().includes(domainLower)

          // Merge data (keep best result per keyword)
          if (domainIdx >= 0 || domainInAnswer) {
            existing.domainFound = true
            if (domainIdx >= 0 && (!existing.yourPosition || domainIdx + 1 < existing.yourPosition)) {
              existing.yourPosition = domainIdx + 1
              existing.yourPageUrl = sources[domainIdx].url
            }
          }

          // Always update search volume and sources
          if (item.ai_search_volume && (!existing.aiSearchVolume || item.ai_search_volume > existing.aiSearchVolume)) {
            existing.aiSearchVolume = item.ai_search_volume
          }

          if (!existing.snippet && item.answer) {
            // Extract a snippet mentioning the domain, or use first 200 chars
            const answer = item.answer as string
            const idx = answer.toLowerCase().indexOf(domainLower)
            if (idx >= 0) {
              const start = Math.max(0, idx - 50)
              const end = Math.min(answer.length, idx + domainLower.length + 100)
              existing.snippet = (start > 0 ? '...' : '') + answer.slice(start, end).trim() + (end < answer.length ? '...' : '')
            }
          }

          // Merge sources
          for (const s of sources) {
            if (!existing.allSources.find((es) => es.domain === s.domain)) {
              existing.allSources.push(s)
            }
          }
        }
      }
    }
  } catch {
    // Return partially filled map
  }

  return map
}

// ── Live LLM response parsing (Perplexity + Claude) ──

export function parseLlmResponseResult(
  response: any,
  domain: string
): PlatformResult {
  const domainLower = domain.toLowerCase().replace(/^www\./, '')

  try {
    const result = response?.tasks?.[0]?.result?.[0]
    if (!result) return emptyPlatform()

    const items = result.items || []
    const sections = items[0]?.sections || []
    const text = sections.map((s: any) => s.text || '').join('\n')
    const annotations: any[] = sections.flatMap((s: any) => s.annotations || [])

    const citedUrls: CitedUrl[] = annotations
      .filter((a: any) => a.url && !a.url.includes('vertexaisearch.cloud.google.com'))
      .map((a: any) => ({
        domain: extractDomain(a.url),
        url: a.url,
        title: a.title || null,
      }))
      .filter((c: CitedUrl) => c.domain.length > 0)

    const foundInText = text.toLowerCase().includes(domainLower)
    const foundInUrls = citedUrls.some((c) => isDomainMatch(c.domain, domainLower))
    const found = foundInText || foundInUrls

    let position: number | null = null
    if (found) {
      const uniqueDomains: string[] = []
      for (const c of citedUrls) {
        if (!uniqueDomains.includes(c.domain)) uniqueDomains.push(c.domain)
      }
      const idx = uniqueDomains.findIndex((d) => isDomainMatch(d, domainLower))
      if (idx >= 0) position = idx + 1
    }

    let snippet: string | null = null
    if (foundInText) {
      const idx = text.toLowerCase().indexOf(domainLower)
      const start = Math.max(0, idx - 50)
      const end = Math.min(text.length, idx + domainLower.length + 100)
      snippet = text.slice(start, end).trim()
      if (start > 0) snippet = '...' + snippet
      if (end < text.length) snippet = snippet + '...'
    }

    return { found, position, snippet, citedUrls }
  } catch {
    return emptyPlatform()
  }
}

// ── Helpers ──

function emptyPlatform(): PlatformResult {
  return { found: false, position: null, snippet: null, citedUrls: [] }
}

function isDomainMatch(a: string, b: string): boolean {
  const cleanA = a.replace(/^www\./, '')
  const cleanB = b.replace(/^www\./, '')
  return cleanA.includes(cleanB) || cleanB.includes(cleanA)
}

function findYourUrl(citedUrls: CitedUrl[], domainLower: string): string | null {
  for (const c of citedUrls) {
    if (isDomainMatch(c.domain, domainLower)) return c.url
  }
  return null
}

function findClosestKeyword(question: string, keywords: string[]): string | null {
  const questionLower = question.toLowerCase()
  // Exact match first
  for (const kw of keywords) {
    if (questionLower === kw.toLowerCase()) return kw
  }
  // Contains match
  for (const kw of keywords) {
    if (questionLower.includes(kw.toLowerCase()) || kw.toLowerCase().includes(questionLower)) return kw
  }
  return null
}

function extractDomain(url: string): string {
  try {
    if (url.includes('vertexaisearch.cloud.google.com')) return ''
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

// ── Deep Dive types and parsers ──

export interface DeepDiveSource {
  domain: string
  url: string
  title: string | null
  isUserDomain: boolean
}

export interface DeepDivePlatformResponse {
  platform: 'google' | 'chatgpt' | 'perplexity' | 'claude'
  answer: string
  sources: DeepDiveSource[]
  domainMentioned: boolean
  error: string | null
}

export interface DeepDiveResult {
  query: string
  domain: string | null
  platforms: DeepDivePlatformResponse[]
}

export function parseDeepDiveMention(
  response: any,
  domain: string | null,
  platform: 'google' | 'chatgpt'
): DeepDivePlatformResponse {
  const domainLower = domain?.toLowerCase().replace(/^www\./, '') || ''
  const items = response?.tasks?.[0]?.result?.[0]?.items || []

  if (items.length === 0) {
    return { platform, answer: '', sources: [], domainMentioned: false, error: 'No cached response found' }
  }

  const parts: string[] = []
  const allSources: DeepDiveSource[] = []
  let domainMentioned = false

  for (const item of items) {
    if (item.question && item.answer) {
      parts.push(`### ${item.question}\n\n${item.answer}`)
    } else if (item.answer) {
      parts.push(item.answer)
    }

    for (const s of (item.sources || [])) {
      const sDomain = (s.domain || '').toLowerCase().replace(/^www\./, '')
      const isUser = domainLower ? isDomainMatch(sDomain, domainLower) : false
      if (isUser) domainMentioned = true
      if (!allSources.find((e) => e.url === s.url)) {
        allSources.push({ domain: sDomain, url: s.url, title: s.title || s.source_name || null, isUserDomain: isUser })
      }
    }

    if (domainLower && (item.answer || '').toLowerCase().includes(domainLower)) {
      domainMentioned = true
    }
  }

  return { platform, answer: parts.join('\n\n---\n\n'), sources: allSources, domainMentioned, error: null }
}

export function parseDeepDiveLlmResponse(
  response: any,
  domain: string | null,
  platform: 'perplexity' | 'claude'
): DeepDivePlatformResponse {
  const domainLower = domain?.toLowerCase().replace(/^www\./, '') || ''
  const result = response?.tasks?.[0]?.result?.[0]
  if (!result) return { platform, answer: '', sources: [], domainMentioned: false, error: 'No response' }

  const sections = result.items?.[0]?.sections || []
  const text = sections.map((s: any) => s.text || '').join('\n\n')
  const annotations: any[] = sections.flatMap((s: any) => s.annotations || [])

  const sources: DeepDiveSource[] = annotations
    .filter((a: any) => a.url && !a.url.includes('vertexaisearch.cloud.google.com'))
    .map((a: any) => {
      const aDomain = extractDomain(a.url)
      return {
        domain: aDomain,
        url: a.url,
        title: a.title || null,
        isUserDomain: domainLower ? isDomainMatch(aDomain, domainLower) : false,
      }
    })
    .filter((s: DeepDiveSource) => s.domain.length > 0)

  const unique = sources.filter((s, i) => sources.findIndex((e) => e.url === s.url) === i)
  const domainMentioned = domainLower
    ? text.toLowerCase().includes(domainLower) || unique.some((s) => s.isUserDomain)
    : false

  return { platform, answer: text, sources: unique, domainMentioned, error: null }
}
