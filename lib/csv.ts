import { MentionRow } from './transform'

function escapeCSV(value: any): string {
  if (value == null) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function generateCSV(rows: MentionRow[]): string {
  const headers = [
    'Keyword',
    'AI Search Volume',
    'Google AI Overview',
    'ChatGPT',
    'Perplexity',
    'Claude',
    'Platforms Present (of 4)',
    'Your Page URL',
    'Your Mention Position',
    'Competitor 1 Domain',
    'Competitor 1 Page URL',
    'Competitor 2 Domain',
    'Competitor 2 Page URL',
    'Competitor 3 Domain',
    'Competitor 3 Page URL',
    'Content Gap',
    'Context Snippet',
  ]

  const lines = [headers.map(escapeCSV).join(',')]

  for (const row of rows) {
    lines.push(
      [
        row.keyword,
        row.ai_search_volume,
        row.google_ai_overview ? 'YES' : 'NO',
        row.chatgpt_mentioned ? 'YES' : 'NO',
        row.perplexity_mentioned ? 'YES' : 'NO',
        row.claude_mentioned ? 'YES' : 'NO',
        row.platforms_present,
        row.your_page_url,
        row.your_mention_position,
        row.competitor_1_domain,
        row.competitor_1_page_url,
        row.competitor_2_domain,
        row.competitor_2_page_url,
        row.competitor_3_domain,
        row.competitor_3_page_url,
        row.content_gap ? 'YES' : 'NO',
        row.context_snippet,
      ]
        .map(escapeCSV)
        .join(',')
    )
  }

  return lines.join('\n')
}
