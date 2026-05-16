-- Migration 004: structured ICP setup profile.
-- Idempotent — safe to re-run. Holds the onboarding ICP inputs that seed
-- the prompt generator and are re-shown on the edit form. Company
-- description stays in brand_description and competitors in
-- competitor_sites; this blob carries the rest:
--   { products: string[], verticals: string[],
--     samplePrompts: string[], icpDescription: string }
-- jsonb (mirrors the kpi_baselines / verticals / prompts precedent).
--
-- Apply via Supabase MCP apply_migration to project jqpyzkqtnzzrhemnyegk
-- ("Progrowth AI Overviews"), same as 001/002/003.

begin;

alter table clients
  add column if not exists icp_profile jsonb not null default '{}'::jsonb;

commit;

-- Verification (run separately):
--   select column_name, data_type
--   from information_schema.columns
--   where table_name = 'clients' and column_name = 'icp_profile';
--   -- expect: icp_profile | jsonb
--
--   select slug, icp_profile from clients;
--   -- expect: existing rows show icp_profile = {} (empty object)
