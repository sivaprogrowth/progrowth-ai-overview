'use client'

import { useState } from 'react'
import { MentionRow } from '@/lib/transform'

interface CrawledPage {
  url: string
  path: string
  hits: number
  visits: number
  bots: string[]
}

interface CrawlAnalysisResult {
  crawledPages: CrawledPage[]
  keywords: string[]
  pageKeywords: Record<string, string[]>
  rows: MentionRow[]
  summary: {
    domain: string
    totalKeywords: number
    googlePresent: number
    chatgptPresent: number
    perplexityPresent: number
    claudePresent: number
    contentGaps: number
  }
}

interface Props {
  onAnalysisComplete: (rows: MentionRow[], summary: any) => void
  isRunning: boolean
  setIsRunning: (running: boolean) => void
}

const BOT_COLORS: Record<string, string> = {
  ChatGPT: 'bg-green-900/50 text-green-300 border-green-700',
  Claude: 'bg-orange-900/50 text-orange-300 border-orange-700',
  Perplexity: 'bg-blue-900/50 text-blue-300 border-blue-700',
  Gemini: 'bg-purple-900/50 text-purple-300 border-purple-700',
}

export default function CrawlAnalysisView({ onAnalysisComplete, isRunning, setIsRunning }: Props) {
  const [crawledPages, setCrawledPages] = useState<CrawledPage[]>([])
  const [pageKeywords, setPageKeywords] = useState<Record<string, string[]>>({})
  const [period, setPeriod] = useState<'week' | 'month'>('month')
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'fetching' | 'analyzing' | 'done'>('idle')

  async function handleAnalyze() {
    setIsRunning(true)
    setError(null)
    setCrawledPages([])
    setPageKeywords({})
    setPhase('fetching')

    try {
      const res = await fetch('/api/matomo/crawls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to fetch')
      }

      const data: CrawlAnalysisResult = await res.json()

      if (!data.crawledPages?.length) {
        setError('No AI bot crawls found for this period.')
        setPhase('idle')
        setIsRunning(false)
        return
      }

      setCrawledPages(data.crawledPages)
      setPageKeywords(data.pageKeywords || {})
      setPhase('done')

      if (data.rows?.length) {
        onAnalysisComplete(data.rows, data.summary)
      }
    } catch (err: any) {
      setError(err.message || 'Analysis failed')
      setPhase('idle')
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">AI Bot Crawl Analysis</h3>
        <p className="text-xs text-gray-400 mb-3">
          Pulls pages crawled by AI chatbots from Matomo, extracts keywords, and checks your visibility across Google AI Overviews &amp; ChatGPT.
        </p>

        <div className="flex gap-2 mb-3">
          {(['week', 'month'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-lime-500 text-black'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              Last {p}
            </button>
          ))}
        </div>

        <button
          onClick={handleAnalyze}
          disabled={isRunning}
          className="w-full py-2.5 px-4 bg-lime-500 hover:bg-lime-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors text-sm"
        >
          {phase === 'fetching'
            ? 'Fetching crawl data...'
            : phase === 'analyzing'
            ? 'Running analysis...'
            : 'Analyze AI Crawls'}
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-xs">
          {error}
        </div>
      )}

      {crawledPages.length > 0 && (
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h4 className="text-xs font-semibold text-gray-300 mb-3 uppercase tracking-wider">
            Pages Crawled by AI Bots
          </h4>
          <div className="space-y-2">
            {crawledPages.map((page) => (
              <div
                key={page.path}
                className="bg-gray-800/50 border border-gray-700 rounded-lg p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white font-mono truncate" title={page.url}>
                      {page.path}
                    </div>
                    {pageKeywords[page.path] && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {pageKeywords[page.path].map((kw) => (
                          <span
                            key={kw}
                            className="px-1.5 py-0.5 bg-gray-700 text-gray-300 rounded text-[10px]"
                          >
                            {kw}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-gray-400">
                      {page.hits} hit{page.hits !== 1 ? 's' : ''}
                    </span>
                    <div className="flex gap-1">
                      {page.bots.map((bot) => (
                        <span
                          key={bot}
                          className={`px-1.5 py-0.5 rounded text-[10px] border ${
                            BOT_COLORS[bot] || 'bg-gray-700 text-gray-300 border-gray-600'
                          }`}
                        >
                          {bot}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
