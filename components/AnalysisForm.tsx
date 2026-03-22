'use client'

import { useState } from 'react'

interface Props {
  onSubmit: (domain: string, keywords: string[], mode: 'keywords' | 'discovery' | 'deepdive') => void
  isRunning: boolean
}

export default function AnalysisForm({ onSubmit, isRunning }: Props) {
  const [mode, setMode] = useState<'keywords' | 'discovery' | 'deepdive'>('keywords')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const form = e.target as HTMLFormElement
        const domain = (form.elements.namedItem('domain') as HTMLInputElement)?.value?.trim() || ''

        if (mode === 'deepdive') {
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
        ]).map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
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

      {mode !== 'deepdive' && (
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

      {mode === 'discovery' && (
        <p className="text-xs text-gray-500">
          Auto-discovers top keywords your domain ranks for in Google, then checks AI visibility across all 4 platforms.
        </p>
      )}

      <button
        type="submit"
        disabled={isRunning}
        className="w-full py-3 px-4 bg-lime-500 hover:bg-lime-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
      >
        {isRunning
          ? 'Analyzing...'
          : mode === 'discovery'
          ? 'Discover & Analyze'
          : mode === 'deepdive'
          ? 'Deep Dive'
          : 'Run Analysis'}
      </button>
    </form>
  )
}
