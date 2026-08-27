-- Migration 007: lead capture for the public AI Grader (Phase 2).
--
-- Additive only — extends public_grader_runs (migrations/006) rather than
-- introducing a new lead/contact table, per the Phase 2 instruction to
-- prefer the smallest schema change that fits. A grader lead only ever
-- exists in the context of one specific report, so it belongs on that row.
--
-- Idempotent — safe to re-run.
--
-- Apply via Supabase MCP apply_migration to project jqpyzkqtnzzrhemnyegk
-- ("Progrowth AI Overviews"), same as 001/003/004/005/006.

begin;

alter table public_grader_runs
  add column if not exists contact_name text,
  add column if not exists email text,
  add column if not exists email_captured_at timestamptz;

-- Lets a future lead-export query find captured leads without scanning
-- every row. Partial: most rows never capture a lead.
create index if not exists public_grader_runs_email_idx
  on public_grader_runs (email)
  where email is not null;

commit;

-- Verification (run separately):
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'public_grader_runs'
--     and column_name in ('contact_name', 'email', 'email_captured_at')
--   order by ordinal_position;
