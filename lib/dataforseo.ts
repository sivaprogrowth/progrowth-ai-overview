const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'

function getAuth(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) throw new Error('DataForSEO credentials not configured')
  return Buffer.from(`${login}:${password}`).toString('base64')
}

async function dfsPost<T = any>(path: string, body: object[]): Promise<T> {
  const res = await fetch(`${DATAFORSEO_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${getAuth()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DataForSEO ${path} failed (${res.status}): ${text}`)
  }
  return res.json()
}

// ── LLM Mentions API (bulk, fast — Google + ChatGPT) ──

// Search mentions for domain + keywords on a platform
export async function fetchMentionSearch(
  targets: Array<{ domain?: string; keyword?: string; match_type?: string; search_filter?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google',
  limit = 100
) {
  return dfsPost('/ai_optimization/llm_mentions/search/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
      limit,
    },
  ])
}

// Aggregated metrics for a domain
export async function fetchAggMetrics(
  targets: Array<{ domain?: string; keyword?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google'
) {
  return dfsPost('/ai_optimization/llm_mentions/aggregated_metrics/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
    },
  ])
}

// Top pages mentioned for keywords
export async function fetchTopPages(
  targets: Array<{ domain?: string; keyword?: string; match_type?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google'
) {
  return dfsPost('/ai_optimization/llm_mentions/top_pages/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
      items_list_limit: 10,
      internal_list_limit: 5,
    },
  ])
}

// Top domains mentioned for keywords
export async function fetchTopDomains(
  targets: Array<{ domain?: string; keyword?: string; match_type?: string; search_scope?: string[] }>,
  platform: 'chat_gpt' | 'google'
) {
  return dfsPost('/ai_optimization/llm_mentions/top_domains/live', [
    {
      target: targets,
      platform,
      language_code: 'en',
      location_name: 'United States',
      items_list_limit: 10,
      internal_list_limit: 5,
    },
  ])
}

// ── AI Keyword Data ──

export async function fetchKeywordVolume(keywords: string[]) {
  return dfsPost('/ai_optimization/ai_keyword_data/keywords_search_volume/live', [
    {
      keywords,
      language_code: 'en',
      location_name: 'United States',
    },
  ])
}

// ── Live LLM Queries (Perplexity + Claude) ──

export async function fetchLlmResponse(
  keyword: string,
  llmType: 'perplexity' | 'claude',
  modelName: string
) {
  const prompt = `What are the best companies and websites for "${keyword}"? List specific company names, their website URLs, and briefly explain why each is recommended.`
  return dfsPost(`/ai_optimization/${llmType}/llm_responses/live`, [
    {
      llm_type: llmType,
      model_name: modelName,
      user_prompt: prompt.slice(0, 500),
      web_search: true,
    },
  ])
}

// ── Domain Discovery (Ranked Keywords) ──

export async function fetchRankedKeywords(
  domain: string,
  limit = 30
): Promise<Array<{ keyword: string; search_volume: number; position: number }>> {
  const response = await dfsPost('/dataforseo_labs/google/ranked_keywords/live', [
    {
      target: domain,
      language_code: 'en',
      location_name: 'United States',
      limit,
      item_types: ['organic'],
      order_by: ['keyword_data.keyword_info.search_volume,desc'],
      filters: [['keyword_data.keyword_info.search_volume', '>', 20]],
    },
  ])

  const items = response?.tasks?.[0]?.result?.[0]?.items || []

  return items.map((item: any) => ({
    keyword: item.keyword_data?.keyword || '',
    search_volume: item.keyword_data?.keyword_info?.search_volume || 0,
    position: item.ranked_serp_element?.serp_item?.rank_absolute || 0,
  })).filter((k: any) => k.keyword.length > 0)
}

export function filterDiscoveredKeywords(
  keywords: Array<{ keyword: string; search_volume: number; position: number }>,
  domain: string
): string[] {
  const domainParts = domain.toLowerCase().replace(/\.(com|net|org|io|services|co)$/, '').split('.')

  return keywords
    .filter((k) => {
      const kw = k.keyword.toLowerCase()
      if (kw.split(/\s+/).length < 2) return false
      if (domainParts.some((part) => kw.includes(part) && part.length > 3)) return false
      if (kw.includes('http') || kw.includes('.com') || kw.includes('.org')) return false
      return true
    })
    .map((k) => k.keyword)
}

// Extract broader 2-word core phrases from long-tail keywords for richer query discovery
export function extractCorePhrases(keywords: string[]): string[] {
  const stopWords = new Set(['for', 'the', 'a', 'an', 'to', 'in', 'of', 'and', 'or', 'how', 'what', 'is', 'are', 'with', 'on', 'by', 'my', 'your', 'do', 'does'])
  const cores = new Set<string>()

  for (const kw of keywords) {
    const words = kw.toLowerCase().split(/\s+/).filter((w) => !stopWords.has(w) && w.length > 2)
    // Extract meaningful 2-word pairs
    if (words.length >= 3) {
      // Take first 2 content words as core phrase
      cores.add(words.slice(0, 2).join(' '))
      // Also try last 2 content words
      cores.add(words.slice(-2).join(' '))
    }
  }

  // Remove cores that are already in the original keywords
  const kwSet = new Set(keywords.map((k) => k.toLowerCase()))
  return Array.from(cores).filter((c) => !kwSet.has(c))
}

export const LLM_MODELS = {
  perplexity: 'sonar',
  claude: 'claude-haiku-4-5',
} as const
