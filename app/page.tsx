'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import LoginForm from '@/components/LoginForm'
import AnalysisForm from '@/components/AnalysisForm'
import ProgressLog, { ProgressEvent } from '@/components/ProgressLog'
import SummaryDashboard from '@/components/SummaryDashboard'
import ResultsTable from '@/components/ResultsTable'
import DownloadButton from '@/components/DownloadButton'
import DeepDiveView from '@/components/DeepDiveView'
import { MentionRow, DeepDiveResult } from '@/lib/transform'
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
  const [loggedIn, setLoggedIn] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isRunning, setIsRunning] = useState(false)
  const [events, setEvents] = useState<ProgressEvent[]>([])
  const [rows, setRows] = useState<MentionRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [csvData, setCsvData] = useState<string | null>(null)
  const [domain, setDomain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'all' | 'gaps'>('all')
  const [deepDiveResult, setDeepDiveResult] = useState<DeepDiveResult | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    fetch('/api/auth/check')
      .then((res) => res.json())
      .then((data) => setLoggedIn(data.authenticated === true))
      .catch(() => setLoggedIn(false))
      .finally(() => setCheckingAuth(false))
  }, [])

  const handleSubmit = useCallback((dom: string, keywords: string[], mode: 'keywords' | 'discovery' | 'deepdive') => {
    setIsRunning(true)
    setEvents([])
    setRows([])
    setSummary(null)
    setCsvData(null)
    setError(null)
    setDomain(dom)
    setActiveTab('all')
    setDeepDiveResult(null)

    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const params = new URLSearchParams({ domain: dom, keywords: keywords.join('\n'), mode })
    const es = new EventSource(`/api/analyze?${params}`)
    eventSourceRef.current = es

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      const timestamp = new Date().toLocaleTimeString()
      setEvents((prev) => [...prev, { ...data, timestamp }])
    })

    es.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data)
      if (data.deepdive) {
        setDeepDiveResult(data.deepdive)
      } else {
        setRows(data.rows)
        setSummary(data.summary)
        setCsvData(generateCSV(data.rows))
      }
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

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!loggedIn) {
    return <LoginForm onLogin={() => setLoggedIn(true)} />
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">
            <span className="text-lime-400">ProGrowth</span> AI Overview
          </h1>
          <p className="text-gray-400 mt-1">
            Analyze your website&apos;s visibility across AI chatbots
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[350px_1fr] gap-8">
          <div className="space-y-6">
            <AnalysisForm onSubmit={handleSubmit} isRunning={isRunning} />
            <ProgressLog events={events} />
            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
                {error}
              </div>
            )}
          </div>

          <div className="space-y-6">
            {deepDiveResult ? (
              <DeepDiveView result={deepDiveResult} />
            ) : (
              <>
                {summary && (
                  <>
                    <SummaryDashboard summary={summary} />
                    <div className="flex justify-end">
                      <DownloadButton csvData={csvData} domain={domain} />
                    </div>
                  </>
                )}
                <ResultsTable rows={rows} activeTab={activeTab} onTabChange={setActiveTab} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
