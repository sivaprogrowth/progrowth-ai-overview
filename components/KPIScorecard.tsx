'use client'

import { useEffect, useState } from 'react'
import type { KPICard } from '@/lib/scorecard'

interface Props {
  initialCards?: KPICard[]
  generatedAt?: string
}

const STATUS_STYLE: Record<KPICard['status'], { dot: string; label: string; text: string }> = {
  ahead: { dot: 'bg-lime-400', label: 'Ahead of pace', text: 'text-lime-300' },
  'on-track': { dot: 'bg-emerald-400', label: 'On track', text: 'text-emerald-300' },
  behind: { dot: 'bg-amber-400', label: 'Behind baseline', text: 'text-amber-300' },
  pending: { dot: 'bg-gray-500', label: 'Pending', text: 'text-gray-400' },
}

function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return value.toLocaleString()
}

function progressPercent(current: number | null, baseline: number, target: number | string): number | null {
  if (current === null || typeof target !== 'number' || target === baseline) return null
  const pct = ((current - baseline) / (target - baseline)) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

function deltaPercent(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined) return null
  if (previous === null || previous === undefined || previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

function deltaLabel(delta: number | null): { text: string; color: string } | null {
  if (delta === null) return null
  if (delta > 0) return { text: `+${delta}% vs prior 30d`, color: 'text-lime-400' }
  if (delta < 0) return { text: `${delta}% vs prior 30d`, color: 'text-amber-400' }
  return { text: 'flat vs prior 30d', color: 'text-gray-400' }
}

/**
 * Tiny inline SVG sparkline — no chart library. Renders a 100x28 area with
 * the series scaled to fit. A pulsing dot marks the most recent point.
 */
function Sparkline({ series }: { series: { weekLabel: string; visits: number }[] }) {
  if (series.length < 2) return null
  const w = 100
  const h = 28
  const padY = 2
  const max = Math.max(...series.map((p) => p.visits), 1)
  const min = Math.min(...series.map((p) => p.visits), 0)
  const range = max - min || 1
  const stepX = w / (series.length - 1)
  const points = series
    .map((p, i) => {
      const x = i * stepX
      const y = h - padY - ((p.visits - min) / range) * (h - 2 * padY)
      return `${x},${y}`
    })
    .join(' ')
  const last = series[series.length - 1]
  const lastX = (series.length - 1) * stepX
  const lastY = h - padY - ((last.visits - min) / range) * (h - 2 * padY)

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} className="overflow-visible">
      <polyline points={points} fill="none" stroke="rgb(132 204 22)" strokeWidth="1.5" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="rgb(190 242 100)" />
    </svg>
  )
}

export default function KPIScorecard({ initialCards, generatedAt: initialGeneratedAt }: Props) {
  const [cards, setCards] = useState<KPICard[] | null>(initialCards ?? null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(initialGeneratedAt ?? null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/scorecard', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCards(data.cards)
      setGeneratedAt(data.generatedAt)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (!initialCards) refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cards) {
    return (
      <div className="text-gray-400 text-sm">
        {error ? `Failed to load scorecard: ${error}` : 'Loading scorecard…'}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">GEO KPI Scorecard</h2>
          <p className="text-gray-400 text-sm mt-1">
            Five metrics covering crawl → cite → click → quality → competitive diagnosis.{' '}
            <a
              href="https://github.com/sivaprogrowth/Progrowth-Website"
              className="text-lime-400 underline-offset-2 hover:underline"
            >
              Definitions doc
            </a>
            .
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="text-xs px-3 py-1.5 rounded-md border border-gray-700 bg-gray-900 hover:bg-gray-800 text-gray-300 disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {generatedAt && (
        <p className="text-xs text-gray-500">
          Last refreshed {new Date(generatedAt).toLocaleString()}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map((card) => {
          const style = STATUS_STYLE[card.status]
          const progress = progressPercent(card.current, card.baseline, card.target30d)
          return (
            <div
              key={card.id}
              className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs uppercase tracking-widest text-gray-500">
                    KPI {card.id} · {card.funnelStage}
                  </div>
                  <div className="text-lg font-semibold text-white">{card.name}</div>
                  <div className="text-sm text-gray-400">{card.question}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                  <span className={`text-xs ${style.text}`}>{style.label}</span>
                </div>
              </div>

              <div>
                <div className="flex items-end justify-between gap-3">
                  <div className="text-3xl font-bold text-white tabular-nums">
                    {formatNumber(card.current)}
                  </div>
                  {(() => {
                    const delta = deltaLabel(deltaPercent(card.current, card.previousPeriod))
                    return delta ? (
                      <div className={`text-xs ${delta.color} mb-1 whitespace-nowrap`}>
                        {delta.text}
                      </div>
                    ) : null
                  })()}
                </div>
                <div className="text-xs text-gray-500">{card.unit}</div>
                {card.weeklySeries && card.weeklySeries.length >= 2 && (
                  <div className="mt-3">
                    <Sparkline series={card.weeklySeries} />
                    <div className="flex justify-between text-[10px] text-gray-500 mt-1 tabular-nums">
                      <span>{card.weeklySeries[0].weekLabel}</span>
                      <span>{card.weeklySeries[card.weeklySeries.length - 1].weekLabel}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="uppercase text-gray-500 tracking-wider">Baseline</div>
                  <div className="text-gray-200 font-medium mt-0.5 tabular-nums">
                    {formatNumber(card.baseline)}
                  </div>
                </div>
                <div>
                  <div className="uppercase text-gray-500 tracking-wider">30d target</div>
                  <div className="text-gray-200 font-medium mt-0.5 tabular-nums">
                    {formatNumber(card.target30d)}
                  </div>
                </div>
                <div>
                  <div className="uppercase text-gray-500 tracking-wider">90d target</div>
                  <div className="text-gray-200 font-medium mt-0.5 tabular-nums">
                    {formatNumber(card.target90d)}
                  </div>
                </div>
              </div>

              {progress !== null && (
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Progress to 30d target</span>
                    <span className="tabular-nums">{progress}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-lime-500 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {card.perEngine && card.perEngine.length > 0 && (
                <div className="border-t border-gray-800 pt-3">
                  <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">
                    Per engine
                  </div>
                  <div className="space-y-1">
                    {card.perEngine.map((slice) => (
                      <div key={slice.engine} className="flex justify-between text-xs">
                        <span className="text-gray-300">{slice.engine}</span>
                        <span className="text-gray-400 tabular-nums">
                          {formatNumber(slice.visits)}
                          {card.perEngineUnit === 'percent' ? '%' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {card.caveat && (
                <div className="rounded-md border border-amber-900/40 bg-amber-950/20 p-3 text-xs text-amber-300/80">
                  {card.caveat}
                </div>
              )}

              {card.pendingReason && (
                <div className="rounded-md border border-gray-800 bg-gray-950/50 p-3 text-xs text-gray-400">
                  {card.pendingReason}
                </div>
              )}

              <div className="text-[11px] text-gray-500 border-t border-gray-800 pt-3 leading-relaxed">
                <div>
                  <span className="text-gray-400">Source:</span> {card.source}
                </div>
                {card.warningThreshold && (
                  <div>
                    <span className="text-gray-400">Warning:</span> {card.warningThreshold}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
