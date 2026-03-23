'use client'

import { useState, useEffect } from 'react'

interface AnalysisSummary {
  id: string
  domain: string
  keywords: string[]
  summary: {
    totalKeywords: number
    googlePresent: number
    chatgptPresent: number
    perplexityPresent: number
    claudePresent: number
    contentGaps: number
  }
  created_at: string
}

interface AnalysisHistoryProps {
  onLoadAnalysis: (id: string) => void
  isRunning: boolean
}

export default function AnalysisHistory({ onLoadAnalysis, isRunning }: AnalysisHistoryProps) {
  const [analyses, setAnalyses] = useState<AnalysisSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/analyses')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setAnalyses(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleLoad = (id: string) => {
    setLoadingId(id)
    onLoadAnalysis(id)
  }

  // Reset loadingId when analysis finishes running
  useEffect(() => {
    if (!isRunning) setLoadingId(null)
  }, [isRunning])

  const refreshHistory = () => {
    setLoading(true)
    fetch('/api/analyses')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) setAnalyses(data)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div className="text-gray-500 text-sm">Loading history...</div>
      </div>
    )
  }

  if (analyses.length === 0) return null

  const displayedAnalyses = expanded ? analyses : analyses.slice(0, 5)

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={refreshHistory}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-300 hover:bg-gray-800/50 transition-colors"
      >
        <span>Past Analyses ({analyses.length})</span>
        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      <div className="border-t border-gray-800">
        {displayedAnalyses.map((a) => {
          const date = new Date(a.created_at)
          const timeStr = date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          })
          const platforms = [
            a.summary.googlePresent,
            a.summary.chatgptPresent,
            a.summary.perplexityPresent,
            a.summary.claudePresent,
          ].filter((n) => n > 0).length

          return (
            <button
              key={a.id}
              onClick={() => handleLoad(a.id)}
              disabled={isRunning}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-800/60 transition-colors border-t border-gray-800/50 first:border-t-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white truncate font-medium">
                  {a.domain}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {a.summary.totalKeywords} keywords &middot; {timeStr}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.summary.contentGaps > 0 && (
                  <span className="text-xs text-red-400 bg-red-900/30 px-1.5 py-0.5 rounded">
                    {a.summary.contentGaps} gaps
                  </span>
                )}
                <div className="flex gap-0.5">
                  {[
                    { present: a.summary.googlePresent, label: 'G' },
                    { present: a.summary.chatgptPresent, label: 'C' },
                    { present: a.summary.perplexityPresent, label: 'P' },
                    { present: a.summary.claudePresent, label: 'Cl' },
                  ].map((p) => (
                    <span
                      key={p.label}
                      className={`text-[10px] w-5 h-5 flex items-center justify-center rounded ${
                        p.present > 0
                          ? 'bg-lime-900/40 text-lime-400'
                          : 'bg-gray-800 text-gray-600'
                      }`}
                    >
                      {p.label}
                    </span>
                  ))}
                </div>
                {loadingId === a.id && (
                  <svg className="w-4 h-4 text-lime-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {analyses.length > 5 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center py-2 text-xs text-gray-500 hover:text-gray-300 border-t border-gray-800 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${analyses.length - 5} more`}
        </button>
      )}
    </div>
  )
}
