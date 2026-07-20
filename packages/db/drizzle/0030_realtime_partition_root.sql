-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- Fixes KDS's board (and POS's OrderPad) silently never syncing without a
-- manual refresh. `kots` and `order_status_events` are both
-- `PARTITION BY RANGE (business_date)` (0000_init_schema.sql); 0015 and 0022
-- added the parent tables to `supabase_realtime` but never set
-- `publish_via_partition_root`, which defaults to false. Without it, logical
-- replication reports changes under the CHILD partition's name (e.g.
-- `kots_2026_07_20`), not the parent `kots`/`order_status_events` name the
-- client subscribes to — so `postgres_changes` never matches and the socket
-- looks perfectly healthy (SUBSCRIBED, heartbeat passing) while silently
-- delivering nothing. This is a publication-level setting, not per-table, so
-- one ALTER retroactively fixes every partitioned table already in the
-- publication.
--
-- Guarded behind an existence check for the same reason as 0015/0022: the
-- docker-compose bench DB has no `supabase_realtime` publication at all.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime set (publish_via_partition_root = true);
  end if;
end $$;
