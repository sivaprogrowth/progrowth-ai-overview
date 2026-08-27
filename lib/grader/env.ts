/**
 * Lightweight environment validation for the grader (Phase 3, Task 5).
 *
 * The existing pattern in this codebase is already fail-fast-on-use:
 * lib/supabase.ts throws at module load if Supabase env vars are missing,
 * and lib/dataforseo.ts's getAuth() throws clearly if DataForSEO
 * credentials are missing. Both are real, working safeguards — this does
 * NOT replace or duplicate them.
 *
 * What was missing: discovering that fact one variable at a time, from
 * whichever one happens to be touched first, mid-request. This gives the
 * grader's own entry point ONE clear, complete error naming every missing
 * variable at once, which matters most exactly when it's needed — setting
 * up a new environment (a fresh Vercel project, a new preview) — since
 * fixing one variable and redeploying just to discover the next missing
 * one costs real time on launch day.
 *
 * Deliberately does NOT validate values, only presence — e.g. it can't
 * tell a real DataForSEO password from a typo'd one. That failure still
 * surfaces the existing way: the provider call fails and is handled by
 * the normal error paths.
 */

const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
] as const

export class GraderEnvError extends Error {
  constructor(public missing: string[]) {
    super(`Grader is misconfigured — missing required environment variable(s): ${missing.join(', ')}`)
    this.name = 'GraderEnvError'
  }
}

/**
 * Throws GraderEnvError listing every missing variable, or returns
 * silently. Cheap (a handful of `process.env` reads) — safe to call on
 * every request rather than only at cold start, so a variable removed
 * from a running deployment is still caught.
 */
export function assertGraderEnv(): void {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name])
  if (missing.length > 0) throw new GraderEnvError(missing)
}
