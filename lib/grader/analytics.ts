'use client'

/**
 * Vendor-neutral funnel event tracking (Phase 3, Task 24).
 *
 * AUDIT FINDING: this codebase has NO client-side analytics vendor wired
 * in anywhere — no Google Analytics/GTM, no PostHog, no Vercel Analytics
 * package, no Matomo tracking snippet (lib/matomo.ts is a SERVER-SIDE API
 * client the internal product uses to pull AI-crawler traffic stats; it
 * is never loaded as a browser script). Grepped for gtag/_paq/posthog/
 * plausible/@vercel/analytics across app+components+package.json — none
 * present. Per Task 24 ("do not introduce a new analytics vendor solely
 * for Phase 3 if one already exists" — one does not), the honest options
 * were: add a real vendor unilaterally (a product/infra decision that
 * isn't this phase's to make), or wire a hook that participates in
 * whatever the team adds later with zero grader-side changes.
 *
 * This does the latter: it pushes into the standard integration points of
 * three common tools (Matomo's `_paq`, Google Analytics' `gtag`,
 * Plausible's `plausible`) IF that global happens to exist, and is a
 * complete, silent no-op otherwise. Today, in this repo, as shipped, it
 * IS a no-op — that is the honest state of Phase 3 analytics, documented
 * here and in the Phase 3 report rather than claimed otherwise. Wiring an
 * actual vendor (most likely Matomo, since the company already runs one
 * for the internal product) is a one-line follow-up once someone decides
 * which site ID public grader traffic should report under.
 *
 * Never sends PII: only whitelisted, non-PII-shaped scalar properties are
 * forwarded, and a defensive key-name filter drops anything that looks
 * like it could carry an email/name/token even if a caller passes one by
 * mistake.
 */

export type GraderAnalyticsEvent =
  | 'grader_viewed'
  | 'grader_submitted'
  | 'grader_analysis_completed'
  | 'grader_analysis_partial'
  | 'grader_analysis_failed'
  | 'grader_report_viewed'
  | 'grader_email_submitted'
  | 'grader_cta_clicked'

type EventProps = Record<string, string | number | boolean>

const SENSITIVE_KEY_RE = /email|name|payload|report|token|key|secret|address|phone/i

function sanitizeProps(props: EventProps): EventProps {
  const clean: EventProps = {}
  for (const [key, value] of Object.entries(props)) {
    if (SENSITIVE_KEY_RE.test(key)) continue
    if (typeof value === 'string' && value.length > 100) continue
    clean[key] = value
  }
  return clean
}

export function trackGraderEvent(event: GraderAnalyticsEvent, props: EventProps = {}): void {
  if (typeof window === 'undefined') return
  const safeProps = sanitizeProps(props)

  try {
    const w = window as unknown as {
      _paq?: { push: (args: unknown[]) => void }
      gtag?: (...args: unknown[]) => void
      plausible?: (name: string, opts?: { props: EventProps }) => void
    }

    w._paq?.push(['trackEvent', 'Grader', event, JSON.stringify(safeProps)])
    w.gtag?.('event', event, safeProps)
    w.plausible?.(event, { props: safeProps })
  } catch {
    // Analytics must never be able to break the product.
  }
}
