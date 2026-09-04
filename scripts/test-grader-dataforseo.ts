/**
 * TEMPORARY development smoke test — NOT part of the product.
 *
 * Exercises the real production grader pipeline (query generation → the
 * real DataForSEO grader adapter → brand/competitor/citation extraction)
 * with LIVE DataForSEO credentials, WITHOUT Supabase and WITHOUT
 * persistence. Reuses the exact functions app/api/grader/analyze/route.ts
 * calls in production — nothing here reimplements or duplicates the
 * provider integration.
 *
 * SUPABASE NOTE (read before "fixing" anything): lib/dataforseo.ts's
 * chat_gpt path (fetchChatgptLlmResponse) calls assertUnderCap(), which
 * reads today's spend from Supabase's `api_cost_log` table and — BY
 * DESIGN — fails closed (throws) if that read fails, rather than silently
 * assuming $0 spent (see the doc comment on getDailySpend in
 * lib/dataforseo.ts). With no Supabase configured, that call WILL throw.
 * This is intentional production safety behavior, not a bug, and this
 * script must not work around it — that's the whole point of the
 * fail-closed design. lib/dataforseo.ts's perplexity/claude path
 * (fetchLlmResponse) does NOT pre-check the cap, so those two engines
 * ARE fully testable without Supabase; only the post-call cost LOG write
 * touches Supabase there, and that's fire-and-forget (logs an error,
 * never throws — see logApiCost).
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=placeholder-key \
 *   node --env-file=.env.local .test-build/scripts/test-grader-dataforseo.js [engines]
 *
 * [engines] = comma-separated subset of chatgpt,perplexity,claude
 *             (default: chatgpt)
 *
 * The two placeholder Supabase vars are NOT real credentials — they exist
 * only so lib/supabase.ts's `createClient()` call constructs without
 * throwing at import time (it validates that a URL/key were PASSED, not
 * that they're real). No query against them can ever succeed; that is
 * the expected, safe failure mode for the chatgpt path described above.
 */

import { normalizeGraderInput } from '../lib/grader/normalize'
import { generateQueries } from '../lib/grader/query-generator'
import { createBrandMatcher } from '../lib/grader/brand-matcher'
import { fetchGraderAnswer } from '../lib/grader/dataforseo'
import type { GraderEngine, EngineAnswer } from '../lib/grader/types'

const HUBSPOT_INPUT = {
  domain: 'hubspot.com',
  companyName: 'HubSpot',
  industry: 'CRM Software',
  service: 'CRM and Marketing Automation',
  location: 'United States',
}

const ALL_ENGINES: GraderEngine[] = ['chatgpt', 'perplexity', 'claude']

function parseRequestedEngines(): GraderEngine[] {
  const arg = process.argv[2]
  if (!arg) return ['chatgpt']
  const requested = arg.split(',').map((s) => s.trim().toLowerCase())
  const valid = requested.filter((e): e is GraderEngine => ALL_ENGINES.includes(e as GraderEngine))
  if (valid.length === 0) {
    console.error(`No valid engines in "${arg}". Valid: ${ALL_ENGINES.join(', ')}`)
    process.exit(1)
  }
  return valid
}

/** Truncate for display — never dump a full raw response. */
function preview(text: string, max = 220): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean || '(empty)'
}

/** Signals worth an immediate STOP per the task's Task 6 — never print raw headers/credentials. */
const AUTH_FAILURE_PATTERNS = [
  /\b401\b/i,
  /unauthoriz/i,
  /invalid.*(login|password|credentials)/i,
  /credentials not configured/i,
  /access denied/i,
  /\b40204\b/i,
  /\b429\b/i,
  /too many requests/i,
]

function looksLikeAuthFailure(message: string): boolean {
  return AUTH_FAILURE_PATTERNS.some((p) => p.test(message))
}

function printResult(engine: GraderEngine, durationMs: number, answer: EngineAnswer) {
  console.log(`\nEngine: ${engine}`)
  console.log(`Provider: ${answer.error ? 'FAILURE' : 'SUCCESS'}`)
  if (answer.error) {
    console.log(`Error (sanitized): ${answer.error}`)
  } else {
    console.log(`Response text preview: ${preview(answer.answerText)}`)
  }
  console.log(`Brand mentioned: ${answer.brandMentioned ? 'YES' : 'NO'}`)
  console.log(`Position: ${answer.brandPosition ?? 'n/a'}`)
  console.log(`Competitors: ${answer.competitors.length ? answer.competitors.join(', ') : '(none)'}`)
  const domains = [...new Set(answer.citations.map((c) => c.domain))]
  console.log(`Citation domains: ${domains.length ? domains.join(', ') : '(none)'}`)
  console.log(`Provider cost: ${answer.costUsd !== null ? `$${answer.costUsd}` : 'Provider cost unavailable'}`)
  console.log(`Duration: ${durationMs}ms`)
}

async function main() {
  console.log('=== ProGrowth AI Grader — DataForSEO Smoke Test (NO Supabase, NO persistence) ===\n')
  console.log(`Company: ${HUBSPOT_INPUT.companyName}`)
  console.log(`Domain: ${HUBSPOT_INPUT.domain}`)

  const normalized = normalizeGraderInput(HUBSPOT_INPUT)
  if (!normalized.ok) {
    console.error('Input normalization failed:', normalized.issues)
    process.exit(1)
  }

  const { queries, warning } = await generateQueries(normalized.value)
  if (warning) console.log(`(query generation warning: ${warning})`)
  console.log(`\nGenerated queries: ${queries.length}`)
  queries.forEach((q, i) => console.log(`  ${i + 1}. [${q.category}/${q.priority}] ${q.query}`))

  const target = queries[0]
  console.log(`\nTesting:\n"${target.query}"`)

  const matcher = createBrandMatcher({ companyName: normalized.value.companyName, domain: normalized.value.domain })
  const engines = parseRequestedEngines()
  console.log(`\nRequested engines: ${engines.join(', ')}`)

  const results: Array<{ engine: GraderEngine; durationMs: number; answer: EngineAnswer }> = []

  for (const engine of engines) {
    const startedAt = Date.now()
    const answer = await fetchGraderAnswer(target.query, engine, matcher)
    const durationMs = Date.now() - startedAt
    printResult(engine, durationMs, answer)
    results.push({ engine, durationMs, answer })

    if (answer.error && looksLikeAuthFailure(answer.error)) {
      console.log(`\n!!! Authentication/rate-limit-shaped failure detected on ${engine}. STOPPING per Task 6. !!!`)
      break
    }
  }

  if (results.length > 1) {
    console.log('\n=== Comparison ===')
    console.log('Engine       Success   Brand Mentioned   Citations   Competitors')
    for (const r of results) {
      const success = r.answer.error ? 'FAIL' : 'PASS'
      console.log(
        `${r.engine.padEnd(12)} ${success.padEnd(9)} ${(r.answer.brandMentioned ? 'YES' : 'NO').padEnd(17)} ` +
          `${String(new Set(r.answer.citations.map((c) => c.domain)).size).padEnd(11)} ${r.answer.competitors.length}`
      )
    }
  }

  const succeeded = results.filter((r) => !r.answer.error)
  const failed = results.filter((r) => r.answer.error)
  const costs = results.map((r) => r.answer.costUsd).filter((c): c is number => c !== null)

  console.log('\n=== Cost Summary ===')
  console.log(`Total live requests attempted: ${results.length}`)
  console.log(`Successful: ${succeeded.length}`)
  console.log(`Failed: ${failed.length}`)
  if (costs.length > 0) {
    const total = costs.reduce((a, b) => a + b, 0)
    console.log(`Provider-reported total cost: $${total.toFixed(4)} (from ${costs.length} call(s) that reported cost)`)
    console.log(`Average cost/request (reporting calls only): $${(total / costs.length).toFixed(4)}`)
  } else {
    console.log('Provider cost unavailable')
  }
}

main().catch((e) => {
  console.error('Smoke test crashed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
