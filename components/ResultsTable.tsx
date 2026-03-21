'use client'

import { useState } from 'react'
import { MentionRow } from '@/lib/transform'

interface Props {
  rows: MentionRow[]
  activeTab: 'all' | 'gaps'
  onTabChange: (tab: 'all' | 'gaps') => void
}

type SortKey = keyof MentionRow
type SortDir = 'asc' | 'desc'

export default function ResultsTable({ rows, activeTab, onTabChange }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('platforms_present')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  if (rows.length === 0) return null

  const filtered = activeTab === 'gaps' ? rows.filter((r) => r.content_gap) : rows

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortKey]
    const bVal = b[sortKey]
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    return (
      <th
        className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase cursor-pointer hover:text-white whitespace-nowrap"
        onClick={() => handleSort(field)}
      >
        {label} {sortKey === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
      </th>
    )
  }

  function PlatformCell({ value }: { value: boolean }) {
    return (
      <td className={`px-3 py-2 text-center text-sm font-medium ${value ? 'text-green-400' : 'text-red-400'}`}>
        {value ? 'YES' : 'NO'}
      </td>
    )
  }

  const gapCount = rows.filter((r) => r.content_gap).length

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => onTabChange('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'all'
              ? 'bg-lime-500 text-black'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          All Keywords ({rows.length})
        </button>
        <button
          onClick={() => onTabChange('gaps')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === 'gaps'
              ? 'bg-red-500 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Content Gaps ({gapCount})
        </button>
      </div>

      <div className="overflow-x-auto border border-gray-700 rounded-lg">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-800">
            <tr>
              <SortHeader label="Keyword" field="keyword" />
              <SortHeader label="AI Volume" field="ai_search_volume" />
              <SortHeader label="Google" field="google_ai_overview" />
              <SortHeader label="ChatGPT" field="chatgpt_mentioned" />
              <SortHeader label="Perplexity" field="perplexity_mentioned" />
              <SortHeader label="Claude" field="claude_mentioned" />
              <SortHeader label="# Platforms" field="platforms_present" />
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase whitespace-nowrap">Your Page</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase whitespace-nowrap">Top Competitor</th>
              <SortHeader label="Gap" field="content_gap" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {sorted.map((row, i) => (
              <tr
                key={i}
                className={`${
                  row.content_gap
                    ? 'bg-red-950/30'
                    : row.platforms_present === 4
                    ? 'bg-green-950/20'
                    : row.platforms_present > 0
                    ? 'bg-yellow-950/10'
                    : ''
                } hover:bg-gray-800/50`}
              >
                <td className="px-3 py-2 text-sm text-white font-medium">{row.keyword}</td>
                <td className="px-3 py-2 text-sm text-gray-300 text-right">
                  {row.ai_search_volume ?? '—'}
                </td>
                <PlatformCell value={row.google_ai_overview} />
                <PlatformCell value={row.chatgpt_mentioned} />
                <PlatformCell value={row.perplexity_mentioned} />
                <PlatformCell value={row.claude_mentioned} />
                <td className="px-3 py-2 text-sm text-center text-gray-300">{row.platforms_present}/4</td>
                <td className="px-3 py-2 text-sm text-blue-400 max-w-[200px] truncate">
                  {row.your_page_url ? (
                    <a href={row.your_page_url} target="_blank" rel="noopener" className="hover:underline">
                      {row.your_page_url.replace(/^https?:\/\//, '').slice(0, 40)}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2 text-sm text-orange-400 max-w-[200px] truncate">
                  {row.competitor_1_page_url ? (
                    <a href={row.competitor_1_page_url} target="_blank" rel="noopener" className="hover:underline">
                      {row.competitor_1_domain}
                    </a>
                  ) : row.competitor_1_domain ? (
                    row.competitor_1_domain
                  ) : (
                    '—'
                  )}
                </td>
                <td className={`px-3 py-2 text-sm text-center font-medium ${row.content_gap ? 'text-red-400' : 'text-gray-600'}`}>
                  {row.content_gap ? 'YES' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
