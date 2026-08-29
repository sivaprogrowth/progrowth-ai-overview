'use client'

/**
 * Top-level report orchestrator (Tasks 11–12). Fetches
 * GET /api/grader/report/[id], handles every documented status
 * (processing/completed/partial/failed) plus not-found/invalid-id/network
 * failure, and renders the full report immediately with no email/name
 * requirement and no locked sections. A completed/partial report shows
 * every section as soon as it loads; opening the same URL again (refresh,
 * new tab, a shared link) shows the same full report every time, since
 * nothing about visibility depends on anything stored client-side.
 *
 * The Phase 1 API is synchronous today, so `processing` should be rare —
 * but this still polls on that status (bounded, with a manual-refresh
 * fallback) so the component is already correct if a real queue lands
 * behind this route later (Task 3/9).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { GraderRunStatus } from '@/lib/grader/types'
import type { PublicGraderReport } from '@/lib/grader/public-report'
import { trackGraderEvent } from '@/lib/grader/analytics'
import { ScoreHero } from './ScoreHero'
import { ScoreBreakdown } from './ScoreBreakdown'
import { EngineVisibility } from './EngineVisibility'
import { CompetitorShare } from './CompetitorShare'
import { QueryResults } from './QueryResults'
import { CitationSources } from './CitationSources'
import { ReadinessChecklist } from './ReadinessChecklist'
import { Recommendations } from './Recommendations'
import { ReportCTA } from './ReportCTA'
import { ReportSection, Pill, SecondaryButton } from './ui'

type FetchOutcome =
  | { kind: 'loading' }
  | { kind: 'network-error' }
  | { kind: 'invalid-id' }
  | { kind: 'not-found' }
  | { kind: 'server-error' }
  | { kind: 'result'; status: GraderRunStatus; report: PublicGraderReport | null; error: string | null }

const POLL_INTERVAL_MS = 4000
const MAX_POLL_ATTEMPTS = 30 // ~2 minutes

export function ReportView({ reportId }: { reportId: string }) {
  const [outcome, setOutcome] = useState<FetchOutcome>({ kind: 'loading' })
  const attemptsRef = useRef(0)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/grader/report/${reportId}`)
      if (res.status === 400) return setOutcome({ kind: 'invalid-id' })
      if (res.status === 404) return setOutcome({ kind: 'not-found' })
      if (!res.ok) return setOutcome({ kind: 'server-error' })

      const data = await res.json()
      setOutcome({ kind: 'result', status: data.status, report: data.report ?? null, error: data.error ?? null })
    } catch {
      setOutcome({ kind: 'network-error' })
    }
  }, [reportId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (outcome.kind !== 'result' || outcome.status !== 'processing') return
    if (attemptsRef.current >= MAX_POLL_ATTEMPTS) return
    const timer = setTimeout(() => {
      attemptsRef.current += 1
      load()
    }, POLL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [outcome, load])

  useEffect(() => {
    if (outcome.kind !== 'result' || !outcome.report) return
    if (outcome.status !== 'completed' && outcome.status !== 'partial') return
    trackGraderEvent('grader_report_viewed', {
      status: outcome.status,
      score_band: outcome.report.score.grade,
      engine_count: outcome.report.queries[0]?.enginesAnswered.length ?? 0,
    })
    // outcome only changes again while status === 'processing' (the poll
    // effect above) — once it settles to completed/partial/failed it is
    // stable, so this fires exactly once per loaded report.
  }, [outcome])

  if (outcome.kind === 'loading') {
    return <ReportSkeleton />
  }

  if (outcome.kind === 'invalid-id') {
    return <SimpleMessage title="This report link looks invalid." body="Please double-check the link, or run a new analysis." showForm />
  }

  if (outcome.kind === 'not-found') {
    return <SimpleMessage title="We couldn't find that report." body="It may have expired or the link may be incorrect." showForm />
  }

  if (outcome.kind === 'network-error') {
    return (
      <SimpleMessage
        title="We couldn't load this report."
        body="Please check your connection and try again."
        retry={() => {
          setOutcome({ kind: 'loading' })
          load()
        }}
      />
    )
  }

  if (outcome.kind === 'server-error') {
    return (
      <SimpleMessage
        title="Something went wrong loading this report."
        body="Please try again in a moment."
        retry={() => {
          setOutcome({ kind: 'loading' })
          load()
        }}
      />
    )
  }

  // outcome.kind === 'result'
  if (outcome.status === 'processing') {
    return (
      <SimpleMessage
        title="Your report is still being generated."
        body="This page will update automatically. You can also check back on this link shortly."
        retry={() => load()}
      />
    )
  }

  if (outcome.status === 'failed') {
    return (
      <SimpleMessage
        title="We couldn't complete this analysis."
        body={outcome.error ?? 'Nothing was charged, and no partial data was saved for this attempt. Please try again.'}
        showForm
      />
    )
  }

  const report = outcome.report
  if (!report) {
    return <SimpleMessage title="This report has no data to show." body="Please try running a new analysis." showForm />
  }

  return (
    <main>
      <ScoreHero company={report.company} score={report.score} summary={report.summary} />

      {outcome.status === 'partial' && (
        <div className="mx-auto max-w-5xl px-4 pt-8 sm:px-6 lg:px-8">
          <Pill tone="warning">
            Some data sources were unavailable during this analysis — this report includes the
            results we were able to verify.
          </Pill>
        </div>
      )}

      <ReportSection eyebrow="Score Breakdown" title="How your score adds up">
        <ScoreBreakdown categories={report.score.categories} />
      </ReportSection>

      <ReportSection eyebrow="AI Presence" title="Your AI Presence">
        <EngineVisibility queries={report.queries} />
      </ReportSection>

      <ReportSection eyebrow="Competitive Visibility" title="How You Compare">
        <CompetitorShare companyName={report.company.companyName} competitors={report.competitors} />
      </ReportSection>

      <ReportSection eyebrow="Query-Level Results" title="Questions That Matter">
        <QueryResults queries={report.queries} />
      </ReportSection>

      <ReportSection eyebrow="Citation Sources" title="Where AI Gets Information">
        <CitationSources citations={report.citations} domain={report.company.domain} />
      </ReportSection>

      <ReportSection eyebrow="AI Readiness" title="AI Readiness">
        <ReadinessChecklist readiness={report.readiness} />
      </ReportSection>

      <ReportSection eyebrow="Priority Opportunities" title="Top Opportunities">
        <Recommendations recommendations={report.recommendations} />
      </ReportSection>

      <ReportCTA />
    </main>
  )
}

function ReportSkeleton() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading report…</span>
      <div className="flex flex-col items-center gap-6">
        <div className="h-56 w-56 animate-pulse rounded-full motion-reduce:animate-none" style={{ backgroundColor: 'var(--grader-surface)' }} />
        <div className="h-6 w-64 animate-pulse rounded-full motion-reduce:animate-none" style={{ backgroundColor: 'var(--grader-surface)' }} />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-full motion-reduce:animate-none" style={{ backgroundColor: 'var(--grader-surface)' }} />
      </div>
      <div className="mt-16 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-2xl motion-reduce:animate-none" style={{ backgroundColor: 'var(--grader-surface)' }} />
        ))}
      </div>
    </main>
  )
}

function SimpleMessage({
  title,
  body,
  retry,
  showForm,
}: {
  title: string
  body: string
  retry?: () => void
  showForm?: boolean
}) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center" role="alert">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--grader-muted-foreground)' }}>
        {body}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {retry && <SecondaryButton onClick={retry}>Try again</SecondaryButton>}
        {showForm && <SecondaryButton href="/grader">Run a new analysis</SecondaryButton>}
      </div>
    </main>
  )
}
