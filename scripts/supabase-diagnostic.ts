/**
 * TEMPORARY diagnostic — NOT part of the product.
 *
 * Read-only Supabase connectivity + schema check for the grader, reusing
 * the EXACT production client (lib/supabase.ts) and the exact production
 * cap-check function (lib/dataforseo.ts's checkDailyCap) — nothing here
 * duplicates that logic. No row is inserted, updated, or deleted.
 *
 * Never prints SUPABASE_SERVICE_ROLE_KEY or any derived value.
 *
 * Usage:
 *   node --require ./scripts/resolve-at-alias.js --env-file=.env.local .scripts-build/scripts/supabase-diagnostic.js
 */

import { supabase } from '../lib/supabase'
import { checkDailyCap } from '../lib/dataforseo'

async function checkTableExists(table: string): Promise<{ exists: boolean; error: string | null }> {
  // NOTE: a `head:true` + `count:'exact'` probe was tried first and is a
  // FALSE POSITIVE for a missing table — PostgREST returns HTTP 204 / no
  // error for that request shape even when the table does not exist
  // (verified directly against this project: the head/count probe said
  // "exists" while a real `.select('id')` on the same table returned a
  // 404 "Could not find the table ... in the schema cache" in the same
  // run). A real data-returning select is the only reliable existence
  // check — using that here.
  const { error } = await supabase.from(table).select('id').limit(1)
  if (!error) return { exists: true, error: null }
  const missing = /could not find the table|does not exist|relation .* does not exist/i.test(error.message)
  return { exists: !missing, error: error.message }
}

async function checkColumns(table: string, columns: string[]): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await supabase.from(table).select(columns.join(',')).limit(1)
  return { ok: !error, error: error?.message ?? null }
}

async function main() {
  console.log('=== Supabase connectivity + schema diagnostic (read-only) ===\n')

  console.log('--- public_grader_runs (migration 006) ---')
  const runsTable = await checkTableExists('public_grader_runs')
  console.log(`Table exists: ${runsTable.exists ? 'YES' : 'NO'}`)
  if (runsTable.error) console.log(`(detail: ${runsTable.error})`)

  if (runsTable.exists) {
    const coreCols = await checkColumns('public_grader_runs', [
      'id', 'company_name', 'domain', 'industry', 'service', 'location',
      'status', 'error_message', 'overall_score', 'visibility_score',
      'citation_score', 'sentiment_score', 'competitive_score', 'coverage_score',
      'readiness_score', 'queries', 'query_results', 'competitors', 'citations',
      'recommendations', 'summary', 'raw_analysis', 'dataforseo_requests',
      'llm_calls', 'estimated_cost', 'created_at', 'completed_at',
    ])
    console.log(`Migration 006 core columns present: ${coreCols.ok ? 'YES' : 'NO'}`)
    if (coreCols.error) console.log(`(detail: ${coreCols.error})`)

    const leadCols = await checkColumns('public_grader_runs', ['contact_name', 'email', 'email_captured_at'])
    console.log(`Migration 007 lead columns present: ${leadCols.ok ? 'YES' : 'NO'}`)
    if (leadCols.error) console.log(`(detail: ${leadCols.error})`)
  }

  console.log('\n--- api_cost_log (migration 005, shared with internal product) ---')
  const costTable = await checkTableExists('api_cost_log')
  console.log(`Table exists: ${costTable.exists ? 'YES' : 'NO'}`)
  if (costTable.error) console.log(`(detail: ${costTable.error})`)

  console.log('\n--- checkDailyCap() — the exact function fetchChatgptLlmResponse calls ---')
  try {
    const cap = await checkDailyCap()
    console.log(`api_cost_log read: SUCCESS`)
    console.log(`Today's recorded DataForSEO spend: $${cap.spent}`)
    console.log(`Configured cap: $${cap.cap}`)
    console.log(`Allowed: ${cap.allowed ? 'YES' : 'NO'}`)
  } catch (e) {
    console.log(`api_cost_log read: FAILED`)
    console.log(`Error (sanitized): ${e instanceof Error ? e.message : String(e)}`)
  }
}

main().catch((e) => {
  console.error('Diagnostic crashed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
