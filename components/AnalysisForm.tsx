'use client'

import { useState, useRef } from 'react'
import Papa from 'papaparse'

interface Props {
  onSubmit: (domain: string, keywords: string[], mode: 'keywords' | 'discovery' | 'deepdive') => void
  onBulkCsvSubmit: (domain: string, keywords: string[], originalRows: string[][], originalHeaders: string[]) => void
  onMatomoMode: () => void
  isRunning: boolean
}

export default function AnalysisForm({ onSubmit, onBulkCsvSubmit, onMatomoMode, isRunning }: Props) {
  const [mode, setMode] = useState<'keywords' | 'discovery' | 'deepdive' | 'bulkcsv' | 'matomo'>('keywords')
  const [csvHeaders, setCsvHeaders] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<string[][]>([])
  const [selectedColumn, setSelectedColumn] = useState<string>('')
  const [csvFileName, setCsvFileName] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvFileName(file.name)

    Papa.parse(file, {
      complete: (result) => {
        const data = result.data as string[][]
        if (data.length < 2) return

        const headers = data[0]
        const rows = data.slice(1).filter((r) => r.some((cell) => cell?.trim()))
        setCsvHeaders(headers)
        setCsvRows(rows)

        // Auto-select keyword column
        const autoMatch = headers.find((h) =>
          /keyword|query|search.?term|topic/i.test(h)
        )
        setSelectedColumn(autoMatch || headers[0])
      },
    })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.target as HTMLFormElement
        const domain = (form.elements.namedItem('domain') as HTMLInputElement)?.value?.trim() || ''

        if (mode === 'bulkcsv') {
          if (!domain || !selectedColumn || csvRows.length === 0) return
          const colIdx = csvHeaders.indexOf(selectedColumn)
          const keywords = csvRows.map((r) => r[colIdx]?.trim()).filter(Boolean)
          if (keywords.length === 0) return
          if (keywords.length > 200) {
            alert('Maximum 200 keywords allowed. Please reduce your CSV.')
            return
          }
          onBulkCsvSubmit(domain, keywords, csvRows, csvHeaders)
        } else if (mode === 'deepdive') {
          const query = (form.elements.namedItem('query') as HTMLInputElement).value.trim()
          if (query) onSubmit(domain, [query], 'deepdive')
        } else if (mode === 'discovery') {
          if (domain) onSubmit(domain, [], 'discovery')
        } else {
          const keywordsText = (form.elements.namedItem('keywords') as HTMLTextAreaElement).value
          const keywords = keywordsText
            .split('\n')
            .map((k) => k.trim())
            .filter(Boolean)
          if (domain && keywords.length > 0) {
            onSubmit(domain, keywords, 'keywords')
          }
        }
      }}
      className="space-y-4"
    >
      <div className="flex gap-1">
        {([
          { key: 'keywords' as const, label: 'Keywords' },
          { key: 'discovery' as const, label: 'Discovery' },
          { key: 'deepdive' as const, label: 'Deep Dive' },
          { key: 'bulkcsv' as const, label: 'Bulk CSV' },
          { key: 'matomo' as const, label: 'AI Crawls' },
        ]).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setMode(m.key)
              if (m.key === 'matomo') onMatomoMode()
            }}
            className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              mode === m.key
                ? 'bg-lime-500 text-black'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'matomo' && (
        <p className="text-xs text-gray-500">
          Pulls pages crawled by AI chatbots from Matomo analytics, extracts keywords, and analyzes your visibility. Use the panel below.
        </p>
      )}

      {mode !== 'deepdive' && mode !== 'matomo' && (
        <div>
          <label htmlFor="domain" className="block text-sm font-medium text-gray-300 mb-1">
            Domain
          </label>
          <input
            id="domain"
            name="domain"
            type="text"
            required
            placeholder="e.g. progrowth.services"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
          />
        </div>
      )}

      {mode === 'deepdive' && (
        <>
          <div>
            <label htmlFor="query" className="block text-sm font-medium text-gray-300 mb-1">
              Query
            </label>
            <input
              id="query"
              name="query"
              type="text"
              required
              placeholder="e.g. what is a fractional cmo"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
            />
          </div>
          <div>
            <label htmlFor="domain" className="block text-sm font-medium text-gray-300 mb-1">
              Your Domain <span className="text-gray-500">(optional — to check if you&apos;re mentioned)</span>
            </label>
            <input
              id="domain"
              name="domain"
              type="text"
              placeholder="e.g. progrowth.services"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
            />
          </div>
          <p className="text-xs text-gray-500">
            See the full AI response from Google AI Overviews, ChatGPT, Perplexity, and Claude for a single query.
          </p>
        </>
      )}

      {mode === 'keywords' && (
        <div>
          <label htmlFor="keywords" className="block text-sm font-medium text-gray-300 mb-1">
            Keywords <span className="text-gray-500">(one per line)</span>
          </label>
          <textarea
            id="keywords"
            name="keywords"
            required
            rows={8}
            placeholder={"fractional cmo\nai marketing agency\nb2b marketing automation\nfractional marketing services"}
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent font-mono text-sm"
          />
        </div>
      )}

      {mode === 'bulkcsv' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Upload CSV
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-3 py-4 bg-gray-800 border border-dashed border-gray-600 rounded-lg text-center cursor-pointer hover:border-lime-500 transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              {csvFileName ? (
                <div>
                  <div className="text-white text-sm">{csvFileName}</div>
                  <div className="text-gray-500 text-xs mt-1">{csvRows.length} rows detected</div>
                </div>
              ) : (
                <div className="text-gray-500 text-sm">Click to select a CSV file</div>
              )}
            </div>
          </div>

          {csvHeaders.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Keyword Column
              </label>
              <select
                value={selectedColumn}
                onChange={(e) => setSelectedColumn(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent"
              >
                {csvHeaders.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          )}

          <p className="text-xs text-gray-500">
            Upload a CSV with keywords. The tool will find the top 3 AI-cited sources for each keyword (Google AI Overviews + ChatGPT) and add them as new columns. Max 200 keywords.
          </p>
        </>
      )}

      {mode === 'discovery' && (
        <p className="text-xs text-gray-500">
          Auto-discovers top keywords your domain ranks for in Google, then checks AI visibility across all 4 platforms.
        </p>
      )}

      <button
        type="submit"
        disabled={isRunning || (mode === 'bulkcsv' && csvRows.length === 0)}
        hidden={mode === 'matomo'}
        className="w-full py-3 px-4 bg-lime-500 hover:bg-lime-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
      >
        {isRunning
          ? 'Analyzing...'
          : mode === 'discovery'
          ? 'Discover & Analyze'
          : mode === 'deepdive'
          ? 'Deep Dive'
          : mode === 'bulkcsv'
          ? 'Enrich & Download'
          : 'Run Analysis'}
      </button>
    </form>
  )
}
