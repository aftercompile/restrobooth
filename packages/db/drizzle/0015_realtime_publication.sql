-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- Phase 3a — live floor map (ROADMAP.md §3, ADR-0005 "sockets for staff
-- surfaces"). Supabase Realtime's postgres_changes only fires for tables
-- added to the `supabase_realtime` publication. table_sessions and kots
-- are the two the floor map / order pad watch for a change-happened
-- signal (never trusted for its payload — every refetch re-runs the real,
-- RLS-scoped query; the realtime event is just "something changed, ask
-- again").
--
-- Guarded behind an existence check because the docker-compose bench DB
-- (port 54329) is plain Postgres with no Supabase stack at all — it has no
-- `supabase_realtime` publication, and this migration still has to apply
-- cleanly there (packages/db/README.md: migrations apply to both DBs).
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table table_sessions, kots;
  end if;
end $$;
