'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

const inputCls =
  'w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-lime-500 focus:border-transparent'

export default function NewClientPage() {
  const router = useRouter()
  const [companyName, setCompanyName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [primaryDomain, setPrimaryDomain] = useState('')
  const [brandDescription, setBrandDescription] = useState('')
  const [altDomains, setAltDomains] = useState('')
  const [brandPatterns, setBrandPatterns] = useState('')
  const [notificationEmail, setNotificationEmail] = useState('')
  const [matomoSiteId, setMatomoSiteId] = useState('')
  const [matomoUrl, setMatomoUrl] = useState('')
  const [cronEnabled, setCronEnabled] = useState(false)
  const [submitting, setSubmitting] = useState(false)
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
    if (!companyName.trim() || !primaryDomain.trim()) {
      setGenError('Enter company name and primary domain first.')
      return
    }
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
          verticalsHint: brandPatterns
            ? brandPatterns.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
            : undefined,
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

  const effectiveSlug = slugEdited ? slug : slugify(companyName)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          company_name: companyName,
          slug: effectiveSlug,
          primary_domain: primaryDomain,
          brand_description: brandDescription,
          alt_domains: altDomains,
          brand_name_patterns: brandPatterns,
          notification_email: notificationEmail,
          matomo_site_id: matomoSiteId,
          matomo_url: matomoUrl,
          cron_enabled: cronEnabled,
          // Persist the AI-generated set when previewed; else server
          // leaves them empty and CANONICAL_PROMPTS defaults apply.
          ...(generated
            ? { verticals: generated.clusters, prompts: generated.prompts }
            : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      router.push(`/clients/${data.client.slug}/scorecard`)
    } catch (err: any) {
      setError(err.message || 'Failed to create client')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">
              Add a <span className="text-lime-400">Client</span>
            </h1>
            <p className="text-gray-400 mt-1 text-sm">
              Identity &amp; config only. Prompt clusters and KPI baselines use
              sensible defaults until customised.
            </p>
          </div>
          <Link
            href="/clients"
            className="text-sm text-gray-400 hover:text-lime-400 underline-offset-2 hover:underline whitespace-nowrap"
          >
            ← All clients
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Company name <span className="text-red-400">*</span>
            </label>
            <input
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Slug <span className="text-red-400">*</span>{' '}
              <span className="text-gray-500">(URL identifier)</span>
            </label>
            <input
              required
              value={effectiveSlug}
              onChange={(e) => {
                setSlugEdited(true)
                setSlug(slugify(e.target.value))
              }}
              placeholder="acme"
              className={inputCls}
            />
            <p className="text-xs text-gray-500 mt-1">
              Used in URLs: <code className="text-gray-400">/clients/{effectiveSlug || 'slug'}/scorecard</code>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Primary domain <span className="text-red-400">*</span>
            </label>
            <input
              required
              value={primaryDomain}
              onChange={(e) => setPrimaryDomain(e.target.value)}
              placeholder="acme.com"
              className={inputCls}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Brand description <span className="text-gray-500">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={brandDescription}
              onChange={(e) => setBrandDescription(e.target.value)}
              placeholder="Acme (acme.com) — a B2B widget platform"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Alt domains <span className="text-gray-500">(one per line)</span>
              </label>
              <textarea
                rows={2}
                value={altDomains}
                onChange={(e) => setAltDomains(e.target.value)}
                placeholder={'www.acme.com'}
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Brand patterns <span className="text-gray-500">(optional, regex)</span>
              </label>
              <textarea
                rows={2}
                value={brandPatterns}
                onChange={(e) => setBrandPatterns(e.target.value)}
                placeholder={'acme\\s?corp'}
                className={inputCls}
              />
              <p className="text-xs text-gray-500 mt-1">
                Domain stem &amp; company name are auto-added.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Notification email <span className="text-gray-500">(digest recipient)</span>
            </label>
            <input
              type="email"
              value={notificationEmail}
              onChange={(e) => setNotificationEmail(e.target.value)}
              placeholder="team@acme.com"
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Matomo site ID <span className="text-gray-500">(optional)</span>
              </label>
              <input
                value={matomoSiteId}
                onChange={(e) => setMatomoSiteId(e.target.value)}
                placeholder="e.g. 1"
                className={inputCls}
              />
              <p className="text-xs text-gray-500 mt-1">
                Without it, KPI 1/2 &amp; AI Crawls render pending.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Matomo URL <span className="text-gray-500">(only if a different instance)</span>
              </label>
              <input
                value={matomoUrl}
                onChange={(e) => setMatomoUrl(e.target.value)}
                placeholder="https://matomo.example.com"
                className={inputCls}
              />
            </div>
          </div>

          <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-gray-200">
                  Tailored prompt set <span className="text-gray-500">(optional)</span>
                </div>
                <p className="text-xs text-gray-500">
                  AI-generate 5 clusters × 25 buyer-intent prompts for this
                  company. Skip and it inherits the default canonical set.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="shrink-0 text-xs px-3 py-2 rounded-md border border-lime-700/50 bg-lime-500/10 text-lime-300 hover:bg-lime-500/20 disabled:opacity-50"
              >
                {generating ? 'Generating…' : generated ? 'Regenerate' : '✨ Generate prompts'}
              </button>
            </div>
            {genError && (
              <div className="text-xs text-red-300">{genError}</div>
            )}
            {generated && (
              <div className="text-xs text-gray-400 space-y-1">
                <div className="text-emerald-300">
                  ✓ {generated.clusters.length} clusters · {generated.prompts.length} prompts ready
                  {generated.rejected.length > 0 &&
                    ` · ${generated.rejected.length} dropped by guardrail`}
                </div>
                <div className="text-gray-500">
                  {generated.clusters.map((c) => c.name).join(' · ')}
                </div>
              </div>
            )}
          </div>

          <label className="flex items-center gap-3 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={cronEnabled}
              onChange={(e) => setCronEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-lime-500 focus:ring-lime-500"
            />
            Enable scheduled crons{' '}
            <span className="text-gray-500">(off by default — incurs DataForSEO cost per run)</span>
          </label>

          {error && (
            <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 px-4 bg-lime-500 hover:bg-lime-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
          >
            {submitting ? 'Creating…' : 'Create client'}
          </button>
        </form>
      </div>
    </div>
  )
}
