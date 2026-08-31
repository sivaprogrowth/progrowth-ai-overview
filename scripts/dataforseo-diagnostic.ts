/**
 * TEMPORARY diagnostic — NOT part of the product.
 *
 * Isolates the 40100 "not authorized" failure seen through the grader by
 * talking to DataForSEO directly, with ZERO imports from lib/dataforseo.ts
 * or lib/grader/dataforseo.ts. This script builds its own Basic Auth
 * header and its own request bodies from scratch, so a PASS/FAIL here can
 * never be explained by a bug in the production client — it isolates the
 * account/credentials themselves from the grader's request construction.
 *
 * Never prints DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, the Authorization
 * header, or any derived value (base64 string, length, etc.).
 *
 * Budget: at most 2 live calls (1 basic-auth check, 1 direct Perplexity
 * call). No retries on failure — a failure IS the result.
 *
 * Usage:
 *   node --env-file=.env.local .scripts-build/scripts/dataforseo-diagnostic.js
 */

const DATAFORSEO_BASE = 'https://api.dataforseo.com/v3'

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN
  const password = process.env.DATAFORSEO_PASSWORD
  if (!login || !password) {
    console.error('DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not present in the environment.')
    process.exit(1)
  }
  // Identical construction to lib/dataforseo.ts's getAuth() — Buffer,
  // "login:password", base64 — reimplemented here (not imported) so this
  // diagnostic cannot inherit a bug from the production client.
  return Buffer.from(`${login}:${password}`).toString('base64')
}

function checkWhitespace(name: string): void {
  const value = process.env[name]
  if (value === undefined) {
    console.log(`${name} present: no`)
    return
  }
  console.log(`${name} present: yes`)
  console.log(`${name} trimmed equals original: ${value.trim() === value ? 'yes' : 'no'}`)
}

async function step0_envFormatting() {
  console.log('=== Step 0: Environment formatting (no values printed) ===')
  checkWhitespace('DATAFORSEO_LOGIN')
  checkWhitespace('DATAFORSEO_PASSWORD')
  console.log('')
}

interface BasicAuthResult {
  ok: boolean
  httpStatus: number
  statusCode: number | null
  statusMessage: string | null
  login: string | null
}

async function step1_basicAuth(): Promise<BasicAuthResult> {
  console.log('=== Step 1: Basic DataForSEO authentication (GET /appendix/user_data) ===')
  const res = await fetch(`${DATAFORSEO_BASE}/appendix/user_data`, {
    method: 'GET',
    headers: { Authorization: `Basic ${authHeader()}` },
  })
  const json: any = await res.json().catch(() => null)
  const task = json?.tasks?.[0]
  const result: BasicAuthResult = {
    ok: res.ok && json?.status_code === 20000,
    httpStatus: res.status,
    statusCode: json?.status_code ?? null,
    statusMessage: json?.status_message ?? null,
    // "login" here is the account's OWN identifier echoed back by DataForSEO
    // (not a secret — it's the same login already known to be in .env.local,
    // surfaced only to confirm the API resolved a real account), never the
    // password or Authorization header.
    login: task?.result?.[0]?.login ?? null,
  }
  console.log(`HTTP: ${result.httpStatus}`)
  console.log(`status_code: ${result.statusCode}`)
  console.log(`status_message: ${result.statusMessage}`)
  console.log(`account/login identifier: ${result.login ?? '(not returned)'}`)
  console.log('')
  return result
}

interface DirectCallResult {
  ok: boolean
  httpStatus: number
  statusCode: number | null
  statusMessage: string | null
  taskStatusCode: number | null
  taskStatusMessage: string | null
}

async function step2_directPerplexity(): Promise<DirectCallResult> {
  console.log('=== Step 2: Direct POST /ai_optimization/perplexity/llm_responses/live ===')
  const body = [
    {
      llm_type: 'perplexity' as const,
      model_name: 'sonar',
      user_prompt: 'What is HubSpot?',
      web_search: true,
    },
  ]
  console.log(`Request body (non-secret): ${JSON.stringify(body)}`)

  const res = await fetch(`${DATAFORSEO_BASE}/ai_optimization/perplexity/llm_responses/live`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json: any = await res.json().catch(() => null)
  const task = json?.tasks?.[0]
  const result: DirectCallResult = {
    ok: res.ok && json?.status_code === 20000 && task?.status_code === 20000,
    httpStatus: res.status,
    statusCode: json?.status_code ?? null,
    statusMessage: json?.status_message ?? null,
    taskStatusCode: task?.status_code ?? null,
    taskStatusMessage: task?.status_message ?? null,
  }
  console.log(`HTTP: ${result.httpStatus}`)
  console.log(`status_code: ${result.statusCode}`)
  console.log(`status_message: ${result.statusMessage}`)
  console.log(`task.status_code: ${result.taskStatusCode}`)
  console.log(`task.status_message: ${result.taskStatusMessage}`)
  if (result.ok) {
    const items = task?.result?.[0]?.items ?? []
    const text: string = items?.[0]?.sections?.map((s: any) => s?.text ?? '').join(' ') ?? ''
    console.log(`Answer preview: ${text.replace(/\s+/g, ' ').trim().slice(0, 150) || '(empty)'}`)
    console.log(`Task cost: ${typeof json?.cost === 'number' ? `$${json.cost}` : 'unavailable'}`)
  }
  console.log('')
  return result
}

async function main() {
  await step0_envFormatting()

  const basicAuth = await step1_basicAuth()
  if (!basicAuth.ok) {
    console.log('!!! Basic authentication FAILED. Per Task instructions: STOPPING. Not calling the AI endpoint. !!!')
    return
  }

  console.log('Basic authentication PASSED — proceeding to the direct AI Optimization endpoint call.\n')
  await step2_directPerplexity()
}

main().catch((e) => {
  console.error('Diagnostic crashed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
