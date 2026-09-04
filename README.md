# ProGrowth AI Overview

Internal ProGrowth tool that measures how visible a website is across AI answer engines — **Google AI Overviews, ChatGPT, Perplexity, Claude, and Grok (xAI)** — with competitor benchmarking, citation-network mapping, and content-gap analysis. Built to support ProGrowth's GEO/AEO service offering.

**Live:** https://aioverviews.progrowth.services
**Vercel:** https://progrowth-ai-overview-siva-7496s-projects.vercel.app
**Repo:** https://github.com/sivaprogrowth/progrowth-ai-overview (private)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Requires the env vars below in `.env.local`.

```bash
npm run dev      # local dev server
npm run build    # production build
npm run start    # serve production build
npm run lint     # next lint
```

## Tech Stack

- **Next.js 14** (App Router) + TypeScript + Tailwind CSS
- **Node 24.x** (see `engines` in `package.json`)
- **Supabase** — multi-tenant client store + analysis snapshots (`@supabase/supabase-js`)
- **DataForSEO API** — LLM Mentions (bulk) + live LLM queries for ChatGPT / Claude / Perplexity / Gemini
- **xAI API** — Grok citations (DataForSEO does not support Grok)
- **Matomo** — AI-traffic attribution and crawl data
- **Brevo SMTP** (via `nodemailer`) — email OTP auth + digest emails
- **Vercel** — hosting + cron jobs

## Architecture

### Hybrid engine approach
1. **DataForSEO LLM Mentions API** (bulk, fast) — Google AI Overviews + ChatGPT.
2. **Live LLM queries** — Perplexity (`sonar`), Claude (`claude-haiku-4-5`), Gemini via DataForSEO.
3. **Grok (xAI)** — fetched directly against the xAI Responses API (`grok-4.3`, `web_search` tool). The `Engine` enum and `ALL_ENGINES` live in `lib/engines.ts` — add an engine there and it propagates.

### Multi-tenant
Clients live in Supabase (`clients` table) with per-client ICP / target verticals / competitor sites. Analyses are stored as snapshots (`analyses` table, sentinel domains like `__citation_network_snapshot__` / `__kpi5_snapshot__`). The clients list is cached via `unstable_cache` (300s TTL); PATCHing a client calls `revalidateTag('clients')` to bust it.

### Auth
Email OTP via Brevo → 6-digit code → HMAC-signed session cookie (30-day sessions). In-memory OTP store, 5-min expiry. Global logout button available.

## Routes

**Pages**
- `/` — redirects to `/grader` (the public ProGrowth AI Grader showcase)
- `/grader`, `/grader/report/[id]` — public AI Grader (no auth — see `app/grader/`)
- `/dashboard` — main analyzer (the internal product's entry point; moved here from `/` so `/` could be reserved for the public grader)
- `/scorecard`, `/clients/[slug]/scorecard` — KPI scorecards
- `/citation-network` — citation-network map (5 engines), cluster editor, tracked queries, re-run/generate triggers
- `/clients`, `/clients/new`, `/clients/[slug]/edit` — tenant management + ICP setup

**API** (`app/api/…`)
- `auth/` — send-otp, verify-otp, check, logout
- `analyze/`, `analyze/batch/` — run analyses (60s maxDuration)
- `clients/`, `clients/[slug]`, `clients/[slug]/trigger`, `clients/generate-prompts` — tenant + prompt generation
- `analyses/`, `scorecard/`, `matomo/kpi`, `matomo/crawls`
- `cron/` — `ai-readiness`, `citation-network`, `geo-seo-gap`, `matomo-analysis`, `sentiment`
- `grader/analyze`, `grader/report/[id]`, `grader/lead` — public AI Grader (see below)

## AEO Grader API (for ProElevate server-to-server integration)

Public, no session cookie required. `analyze` and `report/[id]` additionally
accept an optional `Authorization: Bearer <PROELEVATE_API_KEY>` header — see
`lib/grader/api-auth.ts`. **No token is required for these to keep working**:
the live public grader website (`components/grader/GraderForm.tsx`,
`ReportView.tsx`) calls them from the browser with no header today and
always will, so a missing token is treated as an ordinary public request,
governed by the same rate limit / duplicate-submission guard / daily run
cap as before. A *wrong* token (one that's present but doesn't match) is
rejected with `401 Unauthorized` before any other work runs.

**`POST /api/grader/analyze`**
- Body (JSON): `domain` (required), `companyName` (required), `industry` (required), `service` (optional), `location` (optional) — see `lib/grader/normalize.ts` for exact field limits/rules.
- Auth: optional Bearer token (see above).
- Success: `200 { reportId, status }` where `status` is `completed` / `partial` / `failed`. A `failed` status still returns `200` with a sanitized `error` string — nothing is thrown to the transport layer for an ordinary failed analysis.
- Validation failure: `400 { error: 'Invalid input', issues: [...] }`.
- Auth failure (bad token presented): `401 { error: 'Unauthorized' }`.
- Rate-limited / duplicate submission: `429 { error }`.
- Daily run cap reached: `503 { error }` (fixed, generic message — never reveals the configured limit).
- Runs synchronously; takes roughly 40–130 seconds (`maxDuration: 300` in `vercel.json`).

**`GET /api/grader/report/[id]`**
- Path param: `id` — a UUID.
- Auth: optional Bearer token (see above).
- Success (`completed`/`partial`): `200 { reportId, status, report }` — `report` is the sanitized `PublicGraderReport` shape from `lib/grader/public-report.ts` (no cost, no raw provider error text).
- Still processing: `200 { reportId, status: 'processing' }`.
- Failed: `200 { reportId, status: 'failed', error }`.
- Invalid id format: `400 { error: 'Invalid report id' }`.
- Not found: `404 { error: 'Report not found' }`.
- Auth failure (bad token presented): `401 { error: 'Unauthorized' }`.

No CORS headers are configured for either route, deliberately — the intended ProElevate integration is server-to-server (ProElevate's own backend calling these URLs directly, not a browser on a different origin), which needs none. Add CORS only if a genuine browser-to-grader cross-origin call becomes a real requirement.

## Cron Jobs (`vercel.json`)

- `matomo-analysis` — Mondays 09:00 UTC
- `geo-seo-gap` — Mondays 10:00 UTC

Citation-network and other crons fan out per-client (`lib/cronFanout.ts`) to beat Vercel's 60s function cap.

## Environment Variables

Set in `.env.local` (dev) and on Vercel (production):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-side key |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | DataForSEO API auth |
| `DATAFORSEO_DAILY_CAP` | Daily spend/row cap guard |
| `XAI_API_KEY` | Grok citations (per-team key, needs credits) |
| `MATOMO_URL` / `MATOMO_TOKEN_AUTH` | Matomo AI-traffic data |
| `BREVO_SMTP_USER` / `BREVO_SMTP_PASS` | OTP + digest emails |
| `JWT_SECRET` | HMAC session signing |
| `CRON_SECRET` | Protects cron endpoints |
| `BATCH_API_KEY` | Protects batch analyze endpoint |
| `DIGEST_EMAIL_RECIPIENT` | Scorecard digest recipient |
| `PROELEVATE_API_KEY` | Optional — authenticates ProElevate's server for `grader/analyze` \| `grader/report/[id]` (see AEO Grader API section above). Unset by default; the public grader website works identically either way. |

## Deployment

Pushes to `main` auto-deploy on Vercel. Commit author/committer email must be `siva@progrowth.services` (Vercel Hobby blocks unrecognized GitHub committers — git is configured locally for this repo). DNS: CNAME `aioverviews` → `cname.vercel-dns.com` on the `progrowth.services` Cloudflare zone.

## Notes / Gotchas

- `vercel ls` prints its table to **stderr** (use `2>&1`).
- Direct Supabase writes to `clients` don't bust the `unstable_cache` — the citation-network cron reads stale clusters/prompts until the 300s TTL or a PATCH.
- Grok is **not** in the sentiment pipeline yet (`lib/sentiment.ts` returns null for it).
