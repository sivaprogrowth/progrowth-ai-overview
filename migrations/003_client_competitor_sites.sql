-- Migration 003: per-client competitor sites.
-- Idempotent — safe to re-run. Adds a configured competitor-domain list to
-- clients (today competitors are auto-derived in lib/transform.ts as any
-- non-brand cited domain; this lets a client name its real rivals so they
-- are prioritised in transform output and highlighted in citation-network,
-- and fed to the prompt generator for "X vs <competitor>" comparisons).
--
-- Apply via Supabase MCP apply_migration to project jqpyzkqtnzzrhemnyegk
-- ("Progrowth AI Overviews"), same as 001/002.

begin;

alter table clients
  add column if not exists competitor_sites text[] not null default '{}';

commit;

-- Verification (run separately):
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'clients' and column_name = 'competitor_sites';
--   -- expect: competitor_sites | ARRAY
--
--   select slug, competitor_sites from clients;
--   -- expect: existing rows show competitor_sites = {} (empty array)
