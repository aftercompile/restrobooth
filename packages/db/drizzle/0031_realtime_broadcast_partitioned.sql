-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- postgres_changes on a PARTITIONED table depends on the replication
-- decoder correctly remapping a child partition's WAL records back to the
-- parent's name (what `publish_via_partition_root`, added in 0030, is
-- supposed to buy). In practice the wal2json-based decoder this stack's
-- self-hosted Realtime uses for postgres_changes does not understand
-- publications at all — confirmed directly against this image:
-- `pg_logical_slot_get_changes(..., 'publication-names', 'supabase_realtime')`
-- errors "option ... is unknown". So 0030 fixed the publication correctly,
-- but the symptom it was meant to fix (KDS's board, POS's OrderPad never
-- updating without a manual refresh) persisted anyway, because the CDC
-- layer they actually go through can't honor that setting on this build.
-- `kots` and `order_status_events` are both PARTITION BY RANGE
-- (business_date) (0000_init_schema.sql).
--
-- Fix: stop depending on WAL decoding for these two tables' realtime signal
-- entirely. A `FOR EACH ROW` trigger on the PARTITIONED PARENT fires once
-- per row no matter which child partition the row actually lands in
-- (standard Postgres behaviour), and `realtime.broadcast_changes()`
-- (Supabase's own helper, already present in this image) turns that into a
-- Realtime Broadcast message — a completely different, non-WAL delivery
-- path untouched by any of the above. The trigger passes a STABLE table
-- name as its own argument rather than reading `TG_TABLE_NAME`, which
-- reports the child partition's own name (e.g. `order_status_events_2026_07`)
-- and would otherwise make the topic string silently change every month.
--
-- `realtime.broadcast_changes` marks every message it writes `private =
-- true` (confirmed by inspecting the row it produces in
-- `realtime.messages`), so a subscriber needs an authorizing RLS policy on
-- that table — the same one `channel.subscribe()`'s private-channel
-- handshake checks against the caller's JWT. The topic is
-- `outlet:<outlet_id>:<table>` precisely so that policy can reuse the SAME
-- `accessible_outlet_ids()` helper every other outlet-scoped RLS policy in
-- this schema already uses, rather than inventing a parallel rule.
--
-- Guarded behind an existence check for the same reason as 0015/0022/0030:
-- the docker-compose bench DB has no `realtime` schema at all.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'realtime') then

    create or replace function public.broadcast_outlet_change() returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      stable_table_name text := tg_argv[0];
    begin
      perform realtime.broadcast_changes(
        'outlet:' || coalesce(new.outlet_id, old.outlet_id)::text || ':' || stable_table_name,
        tg_op,
        tg_op,
        stable_table_name,
        tg_table_schema,
        new,
        old
      );
      return coalesce(new, old);
    end;
    $fn$;

    -- order_status_events is append-only (ADR-0005) — INSERT is the whole signal.
    drop trigger if exists order_status_events_broadcast on public.order_status_events;
    create trigger order_status_events_broadcast
      after insert on public.order_status_events
      for each row execute function public.broadcast_outlet_change('order_status_events');

    -- kots also transitions status in place (fired -> printed -> bumped),
    -- which OrderPad's original `event: "*"` filter already covered.
    drop trigger if exists kots_broadcast on public.kots;
    create trigger kots_broadcast
      after insert or update on public.kots
      for each row execute function public.broadcast_outlet_change('kots');

    drop policy if exists outlet_broadcast_read on realtime.messages;
    create policy outlet_broadcast_read on realtime.messages
      for select
      to authenticated
      using ((split_part(topic, ':', 2))::uuid in (select accessible_outlet_ids()));

  end if;
end $$;
