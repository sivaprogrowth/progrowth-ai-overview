'use client'

import { useState, useRef, useCallback } from 'react'
import AnalysisForm from '@/components/AnalysisForm'
import ProgressLog, { ProgressEvent } from '@/components/ProgressLog'
import SummaryDashboard from '@/components/SummaryDashboard'
import ResultsTable from '@/components/ResultsTable'
import DownloadButton from '@/components/DownloadButton'
import { MentionRow } from '@/lib/transform'
import { generateCSV } from '@/lib/csv'

interface Summary {
  domain: string
  totalKeywords: number
  googlePresent: number
  chatgptPresent: number
  perplexityPresent: number
  claudePresent: number
  contentGaps: number
}

export default function Home() {
  const [isRunning, setIsRunning] = useState(false)
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [rows, setRows] = useState<MentionRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [csvData, setCsvData] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'all' | 'gaps'>('all')
  const eventSourceRef = useRef<EventSource | null>(null)

  const handleSubmit = useCallback((domain: string, keywords: string[]) => {
    setIsRunning(true)
    setEvents([])
    setRows([])
    setSummary(null)
    setCsvData(null)
    setError(null)
    setDomain(domain)
    setActiveTab('all')

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const params = new URLSearchParams({
      domain,
      keywords: keywords.join('\n'),
    })

    const es = new EventSource(`/api/analyze?${params}`)
    eventSourceRef.current = es

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      const timestamp = new Date().toLocaleTimeString()
      setEvents((prev) => [...prev, { ...data, timestamp }])
    })

    es.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data)
      setRows(data.rows)
      setSummary(data.summary)
      setCsvData(generateCSV(data.rows))
      setIsRunning(false)
      es.close()
    })

    es.addEventListener('error', (e) => {
      if (e instanceof MessageEvent) {
        const data = JSON.parse(e.data)
        setError(data.message)
      } else {
        setError('Connection lost. Please try again.')
      }
      setIsRunning(false)
      es.close()
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return
      setError('Connection lost. Please try again.')
      setIsRunning(false)
      es.close()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            <span className="text-lime-400">ProGrowth</span> AI Overview
          </h1>
          <p className="text-gray-400 mt-1">
            Analyze your website&apos;s visibility across AI chatbots
          </p>
        </div>

        {/* Layout: Form + Results */}
        <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-8">
          {/* Left: Form */}
          <div className="space-y-6">
            <AnalysisForm onSubmit={handleSubmit} isRunning={isRunning} />
            <ProgressLog events={events} />
            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
                {error}
              </div>
            )}
          </div>

          {/* Right: Results */}
          <div className="space-y-6">
            {summary && (
              <>
                <SummaryDashboard summary={summary} />
                <div className="flex justify-end">
                  <DownloadButton csvData={csvData} domain={domain} />
                </div>
              </>
            )}
            <ResultsTable rows={rows} activeTab={activeTab} onTabChange={setActiveTab} />
          </div>
        </div>
      </div>
    </div>
  )
}
