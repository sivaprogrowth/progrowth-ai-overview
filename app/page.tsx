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
import { generateCSV, generateBulkCsv } from '@/lib/csv'

interface Summary {
  domain: string
  totalKeywords: number
  googlePresent: number
  chatgptPresent: number
  perplexityPresent: number
  claudePresent: number
  contentGaps: number
}

function processChunkViaSSE(
  domain: string,
  keywords: string[],
  onProgress: (event: ProgressEvent) => void
): Promise<MentionRow[]> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      domain,
      keywords: keywords.join('\n'),
      mode: 'bulkcsv',
    })
    const es = new EventSource(`/api/analyze?${params}`)

    es.addEventListener('progress', (e) => {
      const data = JSON.parse(e.data)
      onProgress({ ...data, timestamp: new Date().toLocaleTimeString() })
    })

    es.addEventListener('complete', (e) => {
      const data = JSON.parse(e.data)
      es.close()
      resolve(data.rows)
    })

    es.addEventListener('error', (e) => {
      es.close()
      if (e instanceof MessageEvent) {
        reject(new Error(JSON.parse(e.data).message))
      } else {
        reject(new Error('Connection lost'))
      }
    })

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return
      es.close()
      reject(new Error('Connection lost'))
    }
  })
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
  const [bulkProgress, setBulkProgress] = useState<{ completed: number; total: number } | null>(null)
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
    setBulkProgress(null)

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

  const handleBulkCsvSubmit = useCallback(async (
    dom: string,
    keywords: string[],
    originalRows: string[][],
    originalHeaders: string[]
  ) => {
    setIsRunning(true)
    setEvents([])
    setRows([])
    setSummary(null)
    setCsvData(null)
    setError(null)
    setDomain(dom)
    setActiveTab('all')
    setDeepDiveResult(null)
    setBulkProgress({ completed: 0, total: keywords.length })

    const CHUNK_SIZE = 15
    const allRows: MentionRow[] = []

    for (let i = 0; i < keywords.length; i += CHUNK_SIZE) {
      const chunk = keywords.slice(i, i + CHUNK_SIZE)
      const chunkNum = Math.floor(i / CHUNK_SIZE) + 1
      const totalChunks = Math.ceil(keywords.length / CHUNK_SIZE)

      setEvents((prev) => [
        ...prev,
        {
          step: chunkNum,
          total: totalChunks,
          message: `Processing batch ${chunkNum}/${totalChunks} (keywords ${i + 1}-${Math.min(i + CHUNK_SIZE, keywords.length)} of ${keywords.length})...`,
          timestamp: new Date().toLocaleTimeString(),
        },
      ])

      try {
        const chunkRows = await processChunkViaSSE(dom, chunk, (event) => {
          setEvents((prev) => [...prev, event])
        })
        allRows.push(...chunkRows)
        setBulkProgress({ completed: Math.min(i + CHUNK_SIZE, keywords.length), total: keywords.length })
      } catch (err: any) {
        setError(`Failed on batch ${chunkNum}: ${err.message}`)
        break
      }
    }

    if (allRows.length > 0) {
      setRows(allRows)
      const enrichedCsv = generateBulkCsv(originalHeaders, originalRows, keywords, allRows)
      setCsvData(enrichedCsv)

      const googleCount = allRows.filter((r) => r.google_ai_overview).length
      const chatgptCount = allRows.filter((r) => r.chatgpt_mentioned).length
      setSummary({
        domain: dom,
        totalKeywords: allRows.length,
        googlePresent: googleCount,
        chatgptPresent: chatgptCount,
        perplexityPresent: 0,
        claudePresent: 0,
        contentGaps: allRows.filter((r) => r.content_gap).length,
      })
    }

    setBulkProgress(null)
    setIsRunning(false)
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
            <AnalysisForm
              onSubmit={handleSubmit}
              onBulkCsvSubmit={handleBulkCsvSubmit}
              isRunning={isRunning}
            />

            {bulkProgress && (
              <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                <div className="flex justify-between text-sm text-gray-300 mb-2">
                  <span>Processing keywords...</span>
                  <span>{bulkProgress.completed}/{bulkProgress.total}</span>
                </div>
                <div className="w-full bg-gray-700 rounded-full h-2">
                  <div
                    className="bg-lime-500 h-2 rounded-full transition-all"
                    style={{ width: `${(bulkProgress.completed / bulkProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

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
