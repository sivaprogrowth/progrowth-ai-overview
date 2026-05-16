/**
 * Shared client-input normalisers for the create (POST /api/clients) and
 * edit (PATCH /api/clients/[slug]) endpoints. Dependency-free leaf — no
 * runtime imports, safe anywhere.
 */

/** Split a textarea / comma list into a clean string[]. */
export function toList(v: unknown): string[] {
  if (typeof v !== 'string') {
    return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []
  }
  return v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Strip protocol/path, lowercase — e.g. "https://Acme.com/x" → "acme.com". */
export function cleanDomain(v: string): string {
  return v.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
}

/** A textarea/comma/array list of domains, each cleaned + de-duped. */
export function toDomainList(v: unknown): string[] {
  return [...new Set(toList(v).map(cleanDomain).filter(Boolean))]
}
