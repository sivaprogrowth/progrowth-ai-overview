'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  /** Client slug to target (pins ?client= on the cron run). */
  clientSlug: string
  /** Cron job to run — must be one of the ALLOWED_JOBS in the trigger route. */
  job: 'citation-network' | 'sentiment' | 'geo-seo-gap' | 'ai-readiness' | 'matomo-analysis'
  /** Button label. */
  label: string
  /** Human estimate shown in the confirm dialog + helper text, e.g. "~1 min · ~$8". */
  estimate?: string
  className?: string
}

type Status = 'idle' | 'running' | 'done' | 'pending' | 'error'

/**
 * In-app trigger for a per-client analysis. POSTs to
 * /api/clients/[slug]/trigger (session-authenticated), which proxies the run
 * to /api/cron/<job> with the server-held batch key. Replaces the old
 * "copy this curl with $BATCH_API_KEY" hint so staff can populate a new
 * client's snapshots straight from the UI.
 *
 * Each run costs real API credits, so it confirms before firing and surfaces
 * the cost/time estimate up front.
 */
export default function RunAnalysisButton({ clientSlug, job, label, estimate, className }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState<string>('')

  async function run() {
    const costNote = estimate ? ` This can take ${estimate} in API credits.` : ''
    if (!window.confirm(`Run the ${label.toLowerCase()} for this client now?${costNote}`)) {
      return
    }
    setStatus('running')
    setMessage('')
    try {
      const res = await fetch(`/api/clients/${clientSlug}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ job }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok && res.status !== 202) {
        throw new Error(data?.error || `HTTP ${res.status}`)
      }
      if (data?.pending) {
        setStatus('pending')
        setMessage(data.message || 'Still running — refresh in a couple of minutes.')
        return
      }
      setStatus('done')
      // Re-run the server component so the freshly-stored snapshot renders.
      router.refresh()
    } catch (err: unknown) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : String(err))
    }
  }

  const busy = status === 'running'

  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className ?? ''}`}>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md border border-lime-500/50 bg-lime-500/15 px-3 py-1.5 text-sm font-medium text-lime-300 transition hover:bg-lime-500/25 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Running…' : status === 'done' ? 'Done — refreshing…' : label}
      </button>
      {estimate && status === 'idle' && (
        <span className="text-[11px] text-gray-500">{estimate}</span>
      )}
      {status === 'running' && (
        <span className="text-[11px] text-gray-500">This can take ~1 minute — keep this tab open.</span>
      )}
      {status === 'pending' && <span className="text-[11px] text-amber-400/80">{message}</span>}
      {status === 'error' && <span className="text-[11px] text-red-400">{message}</span>}
    </span>
  )
}
