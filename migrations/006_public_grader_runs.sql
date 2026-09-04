-- Migration 006: public_grader_runs — persistence for the public
-- ProGrowth AI Grader (separate product, Phase 1).
--
-- Deliberately its own table, not a row in `clients`/`analyses`:
--   - submissions are anonymous/public, not tied to an authenticated tenant;
--   - the grader's report shape (queries/competitors/citations/score) has
--     nothing in common with the internal `analyses` snapshot rows;
--   - keeping it isolated means nothing here can affect the internal
--     product's Supabase queries, RLS, or the `clients` cache.
--
-- Idempotent — safe to re-run.
--
-- Apply via Supabase MCP apply_migration to project jqpyzkqtnzzrhemnyegk
-- ("Progrowth AI Overviews"), same as 001/003/004/005.

begin;

create table if not exists public_grader_runs (
  id                  uuid primary key default gen_random_uuid(),

  company_name        text not null,
  domain              text not null,
  industry            text not null,
  service             text,
  location            text,

  status              text not null default 'processing'
                        check (status in ('processing', 'completed', 'partial', 'failed')),
  error_message       text,

  overall_score       numeric(5, 1),
  visibility_score    numeric(5, 1),
  citation_score      numeric(5, 1),
  sentiment_score     numeric(5, 1),
  competitive_score   numeric(5, 1),
  coverage_score      numeric(5, 1),
  readiness_score     numeric(5, 1),

  queries             jsonb not null default '[]'::jsonb,
  query_results       jsonb not null default '[]'::jsonb,
  competitors         jsonb not null default '[]'::jsonb,
  citations           jsonb not null default '{}'::jsonb,
  recommendations     jsonb not null default '[]'::jsonb,
  summary             text,

  -- Full GraderReport as persisted — the exact JSON GET /api/grader/report
  -- returns, so retrieval never has to reassemble it from the columns above.
  raw_analysis        jsonb,

  dataforseo_requests integer not null default 0,
  llm_calls           integer not null default 0,
  estimated_cost      numeric(10, 4),

  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists public_grader_runs_domain_idx on public_grader_runs (domain);
create index if not exists public_grader_runs_status_idx on public_grader_runs (status);
create index if not exists public_grader_runs_created_at_idx on public_grader_runs (created_at desc);

-- Server-side only: every read/write goes through the service-role key in
-- lib/supabase.ts, exactly like every other table in this schema. RLS on
-- with no policy = no anon/authenticated client access.
alter table public_grader_runs enable row level security;

commit;

-- Verification (run separately):
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'public_grader_runs' order by ordinal_position;
--
--   insert into public_grader_runs (company_name, domain, industry)
--   values ('Test Co', 'example.com', 'Testing')
--   returning id, status;
--   -- expect: one row, status = 'processing'
