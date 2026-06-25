'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CanonicalPrompt, PromptCluster, PromptType } from '@/lib/prompts'

const inputCls =
  'w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent text-sm'

const PROMPT_TYPES: PromptType[] = ['comparative', 'task', 'evaluative', 'ideation']

interface IcpProfile {
  products: string[]
  verticals: string[]
  samplePrompts: string[]
  icpDescription: string
}

interface Props {
  slug: string
  companyName: string
  primaryDomain: string
  brandDescription: string
  competitorSites: string[]
  icpProfile: IcpProfile
  clusters: PromptCluster[]
  prompts: CanonicalPrompt[]
}

interface Row {
  text: string
  type: PromptType
  cluster: string
}

const lines = (s: string) =>
  s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)

// Hoisted to module scope — defining it inside the component would
// remount the textarea every keystroke (focus loss).
function Field({
  label,
  hint,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string
  hint: string
  value: string
  onChange: (v: string) => void
  rows?: number
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">
        {label} <span className="text-gray-500">({hint})</span>
      </label>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputCls}
      />
    </div>
  )
}

export default function EditClientForm({
  slug,
  companyName,
  primaryDomain,
  brandDescription: initialDesc,
  competitorSites,
  icpProfile,
  clusters: initialClusters,
  prompts: initialPrompts,
}: Props) {
  const router = useRouter()

  // ── 6 ICP fields ──
  const [companyDesc, setCompanyDesc] = useState(initialDesc)
  const [products, setProducts] = useState(icpProfile.products.join('\n'))
  const [verticals, setVerticals] = useState(icpProfile.verticals.join('\n'))
  const [samplePrompts, setSamplePrompts] = useState(icpProfile.samplePrompts.join('\n'))
  const [icpDescription, setIcpDescription] = useState(icpProfile.icpDescription)
  const [competitorText, setCompetitorText] = useState(competitorSites.join('\n'))

  // ── editable prompt set (seeded from current) ──
  const [clusters, setClusters] = useState<PromptCluster[]>(initialClusters)
  const [rows, setRows] = useState<Row[]>(
    initialPrompts.map((p) => ({ text: p.text, type: p.type, cluster: p.cluster }))
  )
  // What actually invalidates stored snapshots, keyed by (clusterId, promptId):
  //   • a cluster id is ADDED or REMOVED   → snapshot slices orphan
  //   • a prompt's text / type / cluster changes (or rows added/removed)
  // Renaming a cluster's NAME or DESCRIPTION while keeping its id is purely
  // cosmetic — the existing snapshot keeps rendering under the new label, so
  // it must NOT trip the re-baseline warning.
  const clusterIdSig = (cs: PromptCluster[]) => cs.map((c) => c.id).sort().join('|')
  const promptSig = (ps: { text: string; type: PromptType; cluster: string }[]) =>
    JSON.stringify(ps.map((p) => ({ t: p.text, y: p.type, c: p.cluster })))

  const initialClusterIdSig = clusterIdSig(initialClusters)
  const initialPromptSig = promptSig(initialPrompts)

  const idsChanged = clusterIdSig(clusters) !== initialClusterIdSig
  const promptsChanged = promptSig(rows) !== initialPromptSig
  const needsRebaseline = idsChanged || promptsChanged

  const clusterMetaChanged =
    JSON.stringify(clusters.map((c) => ({ id: c.id, n: c.name, d: c.description }))) !==
    JSON.stringify(initialClusters.map((c) => ({ id: c.id, n: c.name, d: c.description })))

  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [genMeta, setGenMeta] = useState<{ rejected: number; cost: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // `full: true` lets the AI invent fresh clusters AND prompts (overwrites
  // your cluster names). Default keeps your existing clusters and only
  // regenerates the prompts into them — so hand-edited cluster names survive.
  async function handleGenerate(opts?: { full?: boolean }) {
    const keepClusters = !opts?.full && clusters.length > 0
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
          description: companyDesc,
          verticalsHint: lines(verticals),
          products: lines(products),
          samplePrompts: lines(samplePrompts),
          icpDescription,
          competitorSites: lines(competitorText),
          fixedClusters: keepClusters ? clusters : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setClusters(data.clusters)
      setRows(
        (data.prompts as CanonicalPrompt[]).map((p) => ({
          text: p.text,
          type: p.type,
          cluster: p.cluster,
        }))
      )
      setGenMeta({ rejected: (data.rejected ?? []).length, cost: data.cost ?? 0 })
    } catch (err: any) {
      setGenError(err.message || 'Generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    setRows((rs) => [
      ...rs,
      { text: '', type: 'evaluative', cluster: clusters[0]?.id ?? '' },
    ])
  }

  // ── cluster editing ──
  // The `id` is the join key to prompts + stored snapshots, so it's never
  // user-editable: editing name/description in place keeps the id stable
  // (cosmetic, no re-baseline). New clusters get a fresh synthetic id.
  function updateCluster(i: number, patch: Partial<PromptCluster>) {
    setClusters((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function addCluster() {
    setClusters((cs) => {
      const taken = new Set(cs.map((c) => c.id))
      let n = cs.length + 1
      let id = `custom-${n}`
      while (taken.has(id)) id = `custom-${++n}`
      return [...cs, { id, name: '', description: '' }]
    })
  }
  function removeCluster(i: number) {
    setClusters((cs) => cs.filter((_, idx) => idx !== i))
  }
  // Prompts pinned to a cluster block its removal until they're reassigned —
  // keeps the save-time "every prompt needs a valid cluster" invariant safe.
  const promptCountByCluster = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.cluster] = (acc[r.cluster] ?? 0) + 1
    return acc
  }, {})

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedClusters = clusters.map((c) => ({
      ...c,
      name: c.name.trim(),
      description: (c.description ?? '').trim(),
    }))
    if (trimmedClusters.some((c) => !c.name)) {
      setError('Every cluster needs a name.')
      return
    }

    const clusterIds = new Set(trimmedClusters.map((c) => c.id))
    const cleaned = rows
      .map((r) => ({ ...r, text: r.text.trim() }))
      .filter((r) => r.text.length > 0)
    if (cleaned.some((r) => !clusterIds.has(r.cluster))) {
      setError('Every prompt must be assigned to one of the listed clusters.')
      return
    }

    const perKey: Record<string, number> = {}
    const finalPrompts: CanonicalPrompt[] = cleaned.map((r) => {
      const k = `${r.cluster}-${r.type[0]}`
      const n = (perKey[k] = (perKey[k] ?? 0) + 1)
      return { id: `${k}${n}`, text: r.text, type: r.type, cluster: r.cluster }
    })

    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          brand_description: companyDesc,
          competitor_sites: competitorText,
          icp_profile: {
            products: lines(products),
            verticals: lines(verticals),
            samplePrompts: lines(samplePrompts),
            icpDescription,
          },
          verticals: trimmedClusters,
          prompts: finalPrompts,
        }),
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
      <Field
        label="Company description"
        hint="what the company does — also used by the sentiment classifier"
        value={companyDesc}
        onChange={setCompanyDesc}
        placeholder="ProGrowth (progrowth.services) — a B2B marketing agency that…"
      />
      <Field
        label="Products to focus on"
        hint="one per line"
        value={products}
        onChange={setProducts}
        placeholder={'Fractional CMO\nAI marketing automation'}
      />
      <Field
        label="Business verticals"
        hint="one per line — steers AI cluster generation"
        value={verticals}
        onChange={setVerticals}
        placeholder={'B2B SaaS\nProfessional services\nFinancial services'}
      />
      <Field
        label="Ideal customer profile / designations"
        hint="who buys — titles, company size, triggers"
        value={icpDescription}
        onChange={setIcpDescription}
        placeholder="Managing Partners at 10–50-person professional-services firms; CMOs at Series B SaaS"
      />
      <Field
        label="Sample prompts"
        hint="optional — example buyer questions to anchor the AI"
        value={samplePrompts}
        onChange={setSamplePrompts}
        placeholder={'best fractional CMO for B2B SaaS\nMarketri vs ProGrowth'}
      />
      <Field
        label="Competitors & top sites tracked"
        hint="optional, one per line — prioritised in analytics"
        value={competitorText}
        onChange={setCompetitorText}
        placeholder={'marketri.com\nkalungi.com'}
      />

      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3">
        <div>
          <div className="text-sm font-medium text-gray-200">
            Clusters <span className="text-gray-500">({clusters.length})</span>
          </div>
          <p className="text-xs text-gray-500">
            The topical buckets every prompt rolls up to. Rename these so they
            represent the business — renaming is cosmetic and keeps existing
            snapshots intact. Adding or removing a cluster re-baselines the data.
          </p>
        </div>

        {clusters.length === 0 ? (
          <p className="text-xs text-gray-500 italic">
            No custom clusters — this client uses the canonical default set.
            Generate below, or add clusters manually.
          </p>
        ) : (
          <div className="space-y-2">
            {clusters.map((c, i) => {
              const inUse = promptCountByCluster[c.id] ?? 0
              return (
                <div key={c.id} className="flex flex-wrap items-start gap-2">
                  <input
                    value={c.name}
                    onChange={(e) => updateCluster(i, { name: e.target.value })}
                    placeholder="Cluster name"
                    className={`${inputCls} flex-[1_1_180px] min-w-[160px] font-medium`}
                  />
                  <input
                    value={c.description ?? ''}
                    onChange={(e) => updateCluster(i, { description: e.target.value })}
                    placeholder="one-line description — why this bucket matters"
                    className={`${inputCls} flex-[2_1_280px] min-w-[220px]`}
                  />
                  <button
                    type="button"
                    onClick={() => removeCluster(i)}
                    disabled={inUse > 0}
                    title={
                      inUse > 0
                        ? `Reassign its ${inUse} prompt${inUse === 1 ? '' : 's'} before removing`
                        : 'Remove cluster'
                    }
                    className="px-2 py-2 text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:hover:text-gray-500 text-sm"
                    aria-label="Remove cluster"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <button
          type="button"
          onClick={addCluster}
          className="text-xs px-3 py-1.5 rounded-md border border-gray-700 bg-gray-900 hover:border-gray-500 text-gray-300"
        >
          + Add cluster
        </button>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-gray-200">
              Tracked prompts <span className="text-gray-500">({rows.length})</span>
            </div>
            <p className="text-xs text-gray-500">
              Edit any prompt, change its type/cluster, add or remove rows.
              {clusters.length > 0
                ? ' Regenerate keeps your clusters above and only rewrites the prompts into them.'
                : ' Generate to create clusters and prompts from the ICP fields above.'}
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => handleGenerate()}
              disabled={generating}
              className="text-xs px-3 py-2 rounded-md border border-lime-700/50 bg-lime-500/10 text-lime-300 hover:bg-lime-500/20 disabled:opacity-50"
            >
              {generating
                ? 'Generating…'
                : clusters.length > 0
                  ? '✨ Regenerate prompts'
                  : '✨ Generate prompts'}
            </button>
            {clusters.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      'Let the AI invent fresh clusters AND prompts? This OVERWRITES your cluster names above.'
                    )
                  )
                    handleGenerate({ full: true })
                }}
                disabled={generating}
                className="text-[11px] text-gray-500 hover:text-gray-300 underline-offset-2 hover:underline disabled:opacity-50"
              >
                Regenerate clusters too
              </button>
            )}
          </div>
        </div>
        {genError && <div className="text-xs text-red-300">{genError}</div>}
        {genMeta && (
          <div className="text-xs text-emerald-300">
            ✓ {clusters.length} clusters · {rows.length} prompts generated
            {genMeta.rejected > 0 && ` · ${genMeta.rejected} dropped by guardrail`} · $
            {genMeta.cost.toFixed(4)}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-xs text-gray-500 italic">
            No custom prompts yet — this client uses the canonical default set.
            Fill the ICP fields and Generate, or add rows manually.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input
                  value={r.text}
                  onChange={(e) => updateRow(i, { text: e.target.value })}
                  placeholder="buyer-intent prompt"
                  className={`${inputCls} flex-1 min-w-[240px]`}
                />
                <select
                  value={r.type}
                  onChange={(e) => updateRow(i, { type: e.target.value as PromptType })}
                  className="px-2 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-xs"
                >
                  {PROMPT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <select
                  value={r.cluster}
                  onChange={(e) => updateRow(i, { cluster: e.target.value })}
                  className="px-2 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-xs max-w-[180px]"
                >
                  {clusters.length === 0 && <option value="">(no clusters)</option>}
                  {clusters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                  className="px-2 py-2 text-gray-500 hover:text-red-400 text-sm"
                  aria-label="Remove prompt"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={addRow}
          disabled={clusters.length === 0}
          className="text-xs px-3 py-1.5 rounded-md border border-gray-700 bg-gray-900 hover:border-gray-500 text-gray-300 disabled:opacity-40"
        >
          + Add prompt
        </button>
      </div>

      {needsRebaseline ? (
        <div className="rounded-md border border-amber-700/50 bg-amber-500/10 p-3 text-xs text-amber-200">
          ⚠ You changed cluster ids or prompt text, which re-baselines KPI 3 &amp;
          the citation network — existing snapshots use the old cluster ids, so
          those slices show &ldquo;no data&rdquo; until a fresh monthly{' '}
          <code>/api/cron/geo-seo-gap?client={slug}&amp;mode=monthly</code> and{' '}
          <code>/api/cron/citation-network?client={slug}</code> run (~$17).
        </div>
      ) : (
        clusterMetaChanged && (
          <div className="rounded-md border border-emerald-700/50 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            ✓ Renaming clusters only — cosmetic. Existing snapshots stay intact
            and re-render under the new names. No queries re-run, no cost.
          </div>
        )
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
        {saving ? 'Saving…' : 'Save ICP'}
      </button>
    </form>
  )
}
