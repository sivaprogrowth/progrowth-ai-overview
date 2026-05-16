'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputCls =
  'w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent'

interface Props {
  slug: string
  companyName: string
  primaryDomain: string
  brandDescription: string
  probeQueries: string[]
  competitorSites: string[]
  verticalsCount: number
  promptsCount: number
}

export default function EditClientForm({
  slug,
  companyName,
  primaryDomain,
  brandDescription: initialDescription,
  probeQueries,
  competitorSites,
  verticalsCount,
  promptsCount,
}: Props) {
  const router = useRouter()
  const [brandDescription, setBrandDescription] = useState(initialDescription)
  const [probeText, setProbeText] = useState(probeQueries.join('\n'))
  const [competitorText, setCompetitorText] = useState(competitorSites.join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [generated, setGenerated] = useState<{
    clusters: { id: string; name: string; description: string }[]
    prompts: { id: string; text: string; type: string; cluster: string }[]
    rejected: string[]
  } | null>(null)

  async function handleGenerate() {
    setGenError(null)
    setGenerating(true)
    try {
      const res = await fetch('/api/clients/generate-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          companyName,
          primaryDomain,
          description: brandDescription,
          competitorSites: competitorText
            .split(/[\n,]/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setGenerated({
        clusters: data.clusters,
        prompts: data.prompts,
        rejected: data.rejected ?? [],
      })
    } catch (err: any) {
      setGenError(err.message || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        brand_description: brandDescription,
        probe_queries: probeText,
        competitor_sites: competitorText,
      }
      // Only replace verticals/prompts when a fresh set was generated.
      if (generated) {
        body.verticals = generated.clusters
        body.prompts = generated.prompts
      }
      const res = await fetch(`/api/clients/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      router.push(`/clients/${slug}/scorecard`)
    } catch (err: any) {
      setError(err.message || 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Brand description <span className="text-gray-500">(ICP context — used by the AI generator &amp; sentiment classifier)</span>
        </label>
        <textarea
          rows={3}
          value={brandDescription}
          onChange={(e) => setBrandDescription(e.target.value)}
          placeholder="ProGrowth (progrowth.services) — a B2B marketing agency for…"
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Competitor sites <span className="text-gray-500">(one per line — prioritised in analytics &amp; comparison prompts)</span>
        </label>
        <textarea
          rows={3}
          value={competitorText}
          onChange={(e) => setCompetitorText(e.target.value)}
          placeholder={'marketri.com\nkalungi.com'}
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Weekly probe queries <span className="text-gray-500">(one per line — KPI 5; empty = first 5 of the prompt set)</span>
        </label>
        <textarea
          rows={3}
          value={probeText}
          onChange={(e) => setProbeText(e.target.value)}
          placeholder={'fractional cmo for b2b saas\nai marketing agency'}
          className={inputCls}
        />
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-200">
              Target verticals &amp; prompts
            </div>
            <p className="text-xs text-gray-500">
              Currently {verticalsCount > 0 ? `${verticalsCount} custom clusters · ${promptsCount} prompts` : 'using canonical defaults (no custom set)'}.
              Regenerate from the brand description + competitors above to replace them.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating}
            className="shrink-0 text-xs px-3 py-2 rounded-md border border-lime-700/50 bg-lime-500/10 text-lime-300 hover:bg-lime-500/20 disabled:opacity-50"
          >
            {generating ? 'Generating…' : generated ? 'Regenerate' : '✨ Regenerate prompts'}
          </button>
        </div>
        {genError && <div className="text-xs text-red-300">{genError}</div>}
        {generated && (
          <div className="text-xs text-gray-400 space-y-1">
            <div className="text-emerald-300">
              ✓ {generated.clusters.length} clusters · {generated.prompts.length} prompts ready to save
              {generated.rejected.length > 0 && ` · ${generated.rejected.length} dropped by guardrail`}
            </div>
            <div className="text-gray-500">
              {generated.clusters.map((c) => c.name).join(' · ')}
            </div>
          </div>
        )}
      </div>

      {generated && (
        <div className="rounded-md border border-amber-700/50 bg-amber-500/10 p-3 text-xs text-amber-200">
          ⚠ Saving new verticals/prompts re-baselines KPI 3 &amp; the citation
          network: existing snapshots use the old cluster ids, so KPI 3 cluster
          slices show &ldquo;no data&rdquo; until a fresh monthly{' '}
          <code>/api/cron/geo-seo-gap?client={slug}&amp;mode=monthly</code> and{' '}
          <code>/api/cron/citation-network?client={slug}</code> run (~$17 in
          DataForSEO credits).
        </div>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="w-full py-3 px-4 bg-lime-500 hover:bg-lime-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}
