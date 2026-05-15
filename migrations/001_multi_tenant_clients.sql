-- Multi-tenant migration: introduces clients table + client_id on analyses.
-- Idempotent — safe to re-run. Backfills existing analyses rows to the
-- 'progrowth' client so no historical data is orphaned.
--
-- Apply via Supabase dashboard SQL editor:
--   https://app.supabase.com/project/wfnsctzivrvffultnxsq/sql/new
-- Or via psql when available.

begin;

-- 1.1 clients table
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  company_name text not null,
  primary_domain text not null,
  alt_domains text[] not null default '{}',
  brand_name_patterns text[] not null default '{}',
  brand_description text not null default '',
  verticals jsonb not null default '[]'::jsonb,
  prompts jsonb not null default '[]'::jsonb,
  probe_queries text[] not null default '{}',
  matomo_site_id text,
  matomo_url text,
  kpi_baselines jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  cron_enabled boolean not null default false,
  notification_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 1.2 seed ProGrowth as the first client (idempotent on slug)
insert into clients (
  slug, company_name, primary_domain, alt_domains,
  brand_name_patterns, brand_description, matomo_site_id,
  cron_enabled, notification_email, kpi_baselines
) values (
  'progrowth',
  'ProGrowth Services',
  'progrowth.services',
  array['www.progrowth.services'],
  array['pro\s*growth(?:\s+services|\s+group)?', 'progrowth\.services'],
  'ProGrowth (progrowth.services) — a B2B marketing agency',
  '1',
  true,
  'siva@progrowth.services',
  '{
    "1": {"baseline": 918, "target30d": 1100, "target90d": 1800},
    "2": {"baseline": 1, "target30d": 5, "target90d": 40},
    "3": {"baseline": 0, "target30d": 8, "target90d": 25},
    "4": {"baseline": 0, "target30d": ">0.5", "target90d": ">0.7"},
    "5": {"baseline": 0, "target30d": "baseline measured", "target90d": "<50%"}
  }'::jsonb
)
on conflict (slug) do nothing;

-- 1.3 add client_id to analyses (additive, non-destructive)
alter table analyses
  add column if not exists client_id uuid references clients(id) on delete set null;

-- 1.4 backfill: any existing row without a client_id belongs to ProGrowth
update analyses
set client_id = (select id from clients where slug = 'progrowth')
where client_id is null;

-- 1.5 indexes for the per-client lookup patterns used by the lib refactors
create index if not exists analyses_client_created_idx
  on analyses (client_id, created_at desc);
create index if not exists analyses_client_domain_idx
  on analyses (client_id, domain);

-- 1.6 keep updated_at fresh on clients
create or replace function clients_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_touch_updated_at_trg on clients;
create trigger clients_touch_updated_at_trg
  before update on clients
  for each row execute function clients_touch_updated_at();

commit;

-- Sanity checks (run as separate SELECT statements to verify):
--
--   select count(*) as orphaned_rows
--   from analyses where client_id is null;
--   -- expect: 0
--
--   select slug, company_name, primary_domain, cron_enabled
--   from clients;
--   -- expect: one row, 'progrowth' / 'ProGrowth Services' / 'progrowth.services' / true
--
--   select count(*) as progrowth_rows
--   from analyses
--   where client_id = (select id from clients where slug = 'progrowth');
--   -- expect: matches the total row count of analyses (pre-migration baseline)
