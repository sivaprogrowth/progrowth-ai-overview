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

export const LLM_MODELS = {
  perplexity: 'sonar',
  claude: 'claude-haiku-4-5',
} as const
