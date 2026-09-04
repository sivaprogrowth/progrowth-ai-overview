/**
 * Shared report-id validation. Pulled out of app/api/grader/report/[id]
 * so app/api/grader/lead can validate the same way without duplicating the
 * regex — a report id that fails this check is never worth a Supabase
 * round trip either way.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidReportId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}
