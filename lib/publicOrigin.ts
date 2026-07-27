/**
 * Resolve the origin a server-side self-fetch should target.
 *
 * WHY THIS EXISTS: the project runs Vercel Deployment Protection with
 * `ssoProtection.deploymentType = "all_except_custom_domains"`, so every
 * *.vercel.app deployment URL is behind Vercel SSO and only the custom
 * domain is exempt. Vercel cron jobs invoke the DEPLOYMENT host, so any
 * fan-out that self-fetched `req.nextUrl.origin` sent its children back
 * at the protected host and got a 302 from Vercel's edge — before the
 * request ever reached our middleware, so a valid Bearer token did not
 * help. The parent still returned 200, which made a completely inert
 * cron look healthy.
 *
 * Observed damage: the citation-network cron (Mon 02:00 UTC) never wrote
 * a snapshot, and geo-seo-gap wrote nothing between 2026-06-16 and
 * 2026-07-27. Every snapshot in the table came from a manual trigger
 * against the custom domain, where the origin happens to be correct.
 *
 * Set PUBLIC_ORIGIN to the custom domain in any environment that has
 * Deployment Protection enabled. The request origin stays the fallback
 * so local dev and preview branches keep working untouched.
 */
import type { NextRequest } from 'next/server'

export function resolvePublicOrigin(req: NextRequest): string {
  const configured = process.env.PUBLIC_ORIGIN?.trim()
  if (!configured) return req.nextUrl.origin
  return configured.replace(/\/+$/, '')
}
