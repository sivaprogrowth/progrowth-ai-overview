'use client'

import { useState } from 'react'
import { ALL_ENGINES, type Engine } from '@/lib/citationNetwork'
import type { CitationNetworkSnapshot, MentionType } from '@/lib/citationNetworkFetcher'
import { PROMPT_CLUSTERS } from '@/lib/prompts'

const SENTIMENT_STYLE: Record<MentionType, { label: string; chip: string; description: string }> = {
  recommended: {
    label: 'Recommended',
    chip: 'bg-lime-500/20 text-lime-300 border-lime-500/40',
    description: 'Engine names ProGrowth as one of the answers',
  },
  mentioned: {
    label: 'Mentioned',
    chip: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    description: 'Name appears in the body but not as a primary recommendation',
  },
  'source-only': {
    label: 'Source-only',
    chip: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    description: 'Cited as a research source but NOT named in the visible answer — hidden value',
  },
  negative: {
    label: 'Negative',
    chip: 'bg-red-500/20 text-red-300 border-red-500/40',
    description: 'Mentioned with explicit unfavourable framing — requires manual review',
  },
}

interface Props {
  snapshot: CitationNetworkSnapshot | null
}

const ENGINE_STYLE: Record<Engine, { label: string; chip: string }> = {
  chatgpt: { label: 'ChatGPT', chip: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  claude: { label: 'Claude', chip: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  perplexity: { label: 'Perplexity', chip: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  gemini: { label: 'Gemini', chip: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
}

function tierLabel(count: number): { label: string; color: string } {
  if (count === 4) return { label: 'Tier 1 · 4-engine', color: 'text-lime-300 bg-lime-500/15 border-lime-500/40' }
  if (count === 3) return { label: 'Tier 2 · 3-engine', color: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/40' }
  return { label: 'Tier 3 · 2-engine', color: 'text-amber-300 bg-amber-500/15 border-amber-500/40' }
}

function formatDate(iso: string | null): string {
  if (!iso) return 'No snapshot'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function CitationNetworkView({ snapshot }: Props) {
  const [activeCluster, setActiveCluster] = useState<string>(
    snapshot?.clustersCovered[0] ?? PROMPT_CLUSTERS[0].id
  )

  if (!snapshot) {
    return (
      <div className='rounded-lg border border-gray-800 bg-gray-900 p-8 text-center'>
        <p className='text-gray-400'>
          No citation network snapshot found in Supabase yet.
        </p>
        <p className='text-gray-500 mt-2 text-sm'>
          Trigger one via{' '}
          <code className='text-lime-400'>
            curl -H &apos;Authorization: Bearer $BATCH_API_KEY&apos; $HOST/api/cron/citation-network?clusters=fcmo
          </code>
        </p>
      </div>
    )
  }

  const tier1 = snapshot.crossEngineTargets.filter((t) => t.engineCount === 4)
  const tier2 = snapshot.crossEngineTargets.filter((t) => t.engineCount === 3)
  const tier3 = snapshot.crossEngineTargets.filter((t) => t.engineCount === 2)

  const activeCells = snapshot.perCell[activeCluster] ?? {}
  const clusterName =
    PROMPT_CLUSTERS.find((c) => c.id === activeCluster)?.name ?? activeCluster

  return (
    <div className='space-y-8'>
      <div className='grid grid-cols-1 sm:grid-cols-4 gap-3'>
        <Stat label='Last run' value={formatDate(snapshot.generatedAt)} />
        <Stat label='Clusters covered' value={`${snapshot.clustersCovered.length} / ${PROMPT_CLUSTERS.length}`} />
        <Stat label='Prompts × engines' value={`${snapshot.promptsRun * snapshot.clustersCovered.length} · 4`} />
        <Stat
          label='ProGrowth citations'
          value={String(snapshot.progrowthAppearances.length)}
          highlight={snapshot.progrowthAppearances.length > 0}
        />
      </div>

      {snapshot.progrowthAppearances.length > 0 && (
        <section>
          <div className='flex items-end justify-between mb-3 flex-wrap gap-2'>
            <h2 className='text-lg font-semibold text-white'>
              Where ProGrowth gets cited
            </h2>
            {snapshot.sentimentClassifiedAt ? (
              <span className='text-xs text-gray-500'>
                Sentiment classified {formatDate(snapshot.sentimentClassifiedAt)}
              </span>
            ) : (
              <span className='text-xs text-amber-400/80'>
                No sentiment classifications yet — run /api/cron/sentiment
              </span>
            )}
          </div>
          <div className='rounded-lg border border-lime-500/40 bg-lime-500/5 overflow-hidden'>
            <table className='w-full text-sm'>
              <thead className='text-left text-gray-400'>
                <tr className='border-b border-gray-800'>
                  <th className='px-4 py-2 font-medium'>Cluster</th>
                  <th className='px-4 py-2 font-medium'>Engine</th>
                  <th className='px-4 py-2 font-medium'>Sentiment</th>
                  <th className='px-4 py-2 font-medium'>Prompt</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.progrowthAppearances.map((app, i) => (
                  <tr key={i} className='border-b border-gray-800/40 last:border-0 align-top'>
                    <td className='px-4 py-3 text-gray-300'>{app.clusterName}</td>
                    <td className='px-4 py-3'>
                      <span className={`inline-block rounded border px-2 py-0.5 text-xs ${ENGINE_STYLE[app.engine].chip}`}>
                        {ENGINE_STYLE[app.engine].label}
                      </span>
                    </td>
                    <td className='px-4 py-3'>
                      {app.sentiment ? (
                        <div className='space-y-1'>
                          <span
                            className={`inline-block rounded border px-2 py-0.5 text-xs ${SENTIMENT_STYLE[app.sentiment.type].chip}`}
                            title={SENTIMENT_STYLE[app.sentiment.type].description}
                          >
                            {SENTIMENT_STYLE[app.sentiment.type].label}
                          </span>
                          <div className='text-[11px] text-gray-500 italic max-w-xs'>
                            {app.sentiment.reasoning}
                          </div>
                          {app.sentiment.snippet && (
                            <details className='text-[11px] text-gray-400 max-w-xs'>
                              <summary className='cursor-pointer text-gray-500 hover:text-gray-300'>
                                Show snippet
                              </summary>
                              <div className='mt-1 p-2 rounded bg-gray-900/50 border border-gray-800 leading-snug'>
                                {app.sentiment.snippet}
                              </div>
                            </details>
                          )}
                        </div>
                      ) : (
                        <span className='text-xs text-gray-500'>—</span>
                      )}
                    </td>
                    <td className='px-4 py-3 text-gray-300 italic'>&ldquo;{app.prompt}&rdquo;</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <h2 className='text-lg font-semibold text-white mb-1'>
          Earned-media hit-list
        </h2>
        <p className='text-sm text-gray-500 mb-4'>
          Domains cited by 2+ AI engines for the same cluster — one outreach
          win compounds across multiple AI surfaces.
        </p>

        {tier1.length > 0 && <TierTable title='Tier 1 — 4-engine reach (target FIRST)' targets={tier1} />}
        {tier2.length > 0 && <TierTable title='Tier 2 — 3-engine reach' targets={tier2} className='mt-6' />}
        {tier3.length > 0 && (
          <details className='mt-6 rounded-lg border border-gray-800 bg-gray-900 px-4 py-3'>
            <summary className='cursor-pointer text-sm font-medium text-gray-300 hover:text-white'>
              Tier 3 — 2-engine reach ({tier3.length} domains)
            </summary>
            <div className='mt-4'>
              <TierTable title='' targets={tier3} compact />
            </div>
          </details>
        )}
      </section>

      <section>
        <h2 className='text-lg font-semibold text-white mb-3'>
          Top domains by cluster × engine
        </h2>
        <div className='flex flex-wrap gap-2 mb-4'>
          {PROMPT_CLUSTERS.map((c) => {
            const covered = snapshot.clustersCovered.includes(c.id)
            const active = c.id === activeCluster
            return (
              <button
                key={c.id}
                onClick={() => setActiveCluster(c.id)}
                disabled={!covered}
                className={`px-3 py-1.5 rounded text-sm border transition ${
                  active
                    ? 'border-lime-400 bg-lime-500/20 text-lime-300'
                    : covered
                    ? 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'
                    : 'border-gray-800 bg-gray-900/50 text-gray-600 cursor-not-allowed'
                }`}
              >
                {c.name}
                {!covered && <span className='ml-1 text-xs'>(no data)</span>}
              </button>
            )
          })}
        </div>

        <p className='text-xs text-gray-500 mb-3'>
          {clusterName} · top 15 domains per engine, ranked by hit count across the 5 prompts in this cluster
        </p>

        <div className='grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4'>
          {ALL_ENGINES.map((engine) => {
            const ranks = activeCells[engine] ?? []
            return (
              <div key={engine} className='rounded-lg border border-gray-800 bg-gray-900'>
                <div className={`px-3 py-2 border-b border-gray-800 ${ENGINE_STYLE[engine].chip} rounded-t-lg`}>
                  <span className='font-medium'>{ENGINE_STYLE[engine].label}</span>
                  <span className='ml-2 text-xs opacity-70'>{ranks.length} domains</span>
                </div>
                <ol className='text-sm'>
                  {ranks.length === 0 && (
                    <li className='px-3 py-3 text-gray-500 italic'>No data</li>
                  )}
                  {ranks.map((r, i) => (
                    <li
                      key={r.domain}
                      className={`flex items-center justify-between px-3 py-1.5 border-b border-gray-800/40 last:border-0 ${
                        r.isProgrowth ? 'bg-lime-500/10' : ''
                      }`}
                    >
                      <span className='flex items-center gap-2 min-w-0'>
                        <span className='text-gray-500 text-xs w-5 shrink-0'>{i + 1}.</span>
                        <span
                          className={`truncate ${
                            r.isProgrowth ? 'text-lime-300 font-medium' : 'text-gray-300'
                          }`}
                          title={r.domain}
                        >
                          {r.domain}
                        </span>
                      </span>
                      <span className='text-xs text-gray-500 ml-2 shrink-0'>×{r.hits}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className='rounded-lg border border-gray-800 bg-gray-900 px-4 py-3'>
      <div className='text-xs text-gray-500 uppercase tracking-wide'>{label}</div>
      <div className={`mt-1 text-base font-medium ${highlight ? 'text-lime-300' : 'text-white'}`}>
        {value}
      </div>
    </div>
  )
}

function TierTable({
  title,
  targets,
  className,
  compact,
}: {
  title: string
  targets: CitationNetworkSnapshot['crossEngineTargets']
  className?: string
  compact?: boolean
}) {
  return (
    <div className={className}>
      {title && (
        <div className='flex items-center gap-2 mb-2'>
          <span
            className={`text-xs border px-2 py-0.5 rounded ${
              targets[0] ? tierLabel(targets[0].engineCount).color : ''
            }`}
          >
            {targets[0] ? tierLabel(targets[0].engineCount).label : ''}
          </span>
          <h3 className='text-sm font-medium text-white'>{title}</h3>
        </div>
      )}
      <div className='rounded-lg border border-gray-800 bg-gray-900 overflow-hidden'>
        <table className='w-full text-sm'>
          <thead className='text-left text-gray-400 text-xs uppercase'>
            <tr className='border-b border-gray-800'>
              <th className='px-4 py-2 font-medium'>Domain</th>
              <th className='px-4 py-2 font-medium'>Cluster</th>
              <th className='px-4 py-2 font-medium'>Engines</th>
              {!compact && <th className='px-4 py-2 font-medium text-right'>Total hits</th>}
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={`${t.clusterId}|${t.domain}`} className='border-b border-gray-800/40 last:border-0'>
                <td className='px-4 py-2 text-white font-medium'>{t.domain}</td>
                <td className='px-4 py-2 text-gray-400 text-xs'>{t.clusterName}</td>
                <td className='px-4 py-2'>
                  <div className='flex gap-1 flex-wrap'>
                    {t.engines.map((e) => (
                      <span
                        key={e}
                        className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${ENGINE_STYLE[e].chip}`}
                      >
                        {ENGINE_STYLE[e].label}
                      </span>
                    ))}
                  </div>
                </td>
                {!compact && <td className='px-4 py-2 text-right text-gray-400 text-xs'>{t.totalHits}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
