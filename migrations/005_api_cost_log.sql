-- Migration 005: api_cost_log — the table the DataForSEO spend cap reads.
-- Idempotent — safe to re-run.
--
-- WHY THIS IS A BUG FIX, NOT A FEATURE: lib/dataforseo.ts has read and
-- written `api_cost_log` since 14b4169 (2026-05-16, "Task 26"), but no
-- migration ever created it. getDailySpend() discarded the Supabase error
-- and returned 0, so checkDailyCap() answered `allowed: true` on every
-- call from the day it shipped, and logApiCost() wrote nothing. The
-- DATAFORSEO_DAILY_CAP guard has never once fired, and there is no spend
-- history to reconstruct.
--
-- Ships alongside raising DATAFORSEO_DAILY_CAP from $5 to $50. Measured
-- real costs: citation-network ~$8/run, matomo-analysis ~$11.60/week run
-- (~$44 in month mode). A $5 cap would block all three on the first call
-- the moment this table starts working.
--
-- Apply via Supabase MCP apply_migration to project jqpyzkqtnzzrhemnyegk
-- ("Progrowth AI Overviews"), same as 001/003/004.

begin;

create table if not exists api_cost_log (
  id          bigserial primary key,
  date        date        not null default (now() at time zone 'utc')::date,
  endpoint    text        not null,
  cost        numeric(10, 4) not null default 0,
  calls       integer     not null default 1,
  created_at  timestamptz not null default now()
);

-- getDailySpend() filters on `date` alone; this is the only read path.
create index if not exists api_cost_log_date_idx on api_cost_log (date);

-- Server-side only: every read/write goes through the service-role key in
-- lib/supabase.ts. RLS on with no policy = no anon/authenticated access,
-- matching how the rest of this schema treats server-owned tables.
alter table api_cost_log enable row level security;

commit;

-- Verification (run separately):
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'api_cost_log' order by ordinal_position;
--   -- expect: id bigint | date date | endpoint text | cost numeric
--   --         calls integer | created_at timestamp with time zone
--
--   select date, endpoint, sum(cost) spend, sum(calls) calls
--   from api_cost_log group by 1, 2 order by 1 desc;
--   -- expect: rows appear after the next paid DataForSEO call
