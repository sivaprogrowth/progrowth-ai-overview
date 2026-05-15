/**
 * Per-request client-context resolution.
 *
 * Used by:
 *   - Server components (pages under app/) — pass `cookies()` from
 *     'next/headers'
 *   - Route handlers — pass the NextRequest
 *
 * Resolution order:
 *   1. ?client=<slug> query param (highest priority, lets curl + cron URLs
 *      target a specific client without touching cookies)
 *   2. `client_slug` cookie (set by the ClientSwitcher UI)
 *   3. Fallback to DEFAULT_CLIENT_SLUG ('progrowth')
 */

import type { NextRequest } from 'next/server'
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'
import { getClientBySlug, getDefaultClient, type Client } from './clients'

export const CLIENT_COOKIE_NAME = 'client_slug'

type CookieSource = ReadonlyRequestCookies | { get(name: string): { value: string } | undefined }

/**
 * Resolve from a NextRequest (route handlers).
 *   const client = await getClientFromRequest(req)
 */
export async function getClientFromRequest(req: NextRequest): Promise<Client> {
  const qs = req.nextUrl.searchParams.get('client')
  if (qs) {
    const c = await getClientBySlug(qs)
    if (c) return c
  }
  const cookie = req.cookies.get(CLIENT_COOKIE_NAME)?.value
  if (cookie) {
    const c = await getClientBySlug(cookie)
    if (c) return c
  }
  return getDefaultClient()
}

/**
 * Resolve from a cookies() bag (server components).
 *   const cookieJar = await cookies()
 *   const client = await getClientFromCookies(cookieJar)
 */
export async function getClientFromCookies(cookieJar: CookieSource): Promise<Client> {
  const slug = cookieJar.get(CLIENT_COOKIE_NAME)?.value
  if (slug) {
    const c = await getClientBySlug(slug)
    if (c) return c
  }
  return getDefaultClient()
}

/**
 * Resolve from a slug string when the caller already knows which client
 * they want (e.g. dynamic route /clients/[slug]/scorecard).
 * Returns null if the slug doesn't resolve, so the caller can 404.
 */
export async function getClientFromSlug(slug: string): Promise<Client | null> {
  return getClientBySlug(slug)
}
