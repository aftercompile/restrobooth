-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- Phase 4 (KDS) — ADR-0005's sequence-numbered event log, finally wired up.
-- order_status_events and outlet_event_counters have existed since Phase 1
-- and nothing has ever written to them: every mutation's "did the KOT
-- change" and "is there a durable record a client can catch up from" were
-- two different questions, and only the first was ever answered. This is
-- the whole mechanism ADR-0005 §1 calls "not an error, the normal expected
-- consequence of a socket blip, handled without the user seeing anything"
-- — without it, no reconnect/gap-detection logic has anything to read.
-- =============================================================================

-- Row-locked per-outlet monotonic sequence. Simpler than the invoice
-- allocator (drizzle/0016): no offline block-reservation is needed here —
-- an event is only ever written inside a real, already-committing server
-- transaction (online-immediate or replayed later from the POS offline
-- outbox), so there's no "assign a number before we know if this succeeds"
-- problem the way invoice numbering has. A single atomic upsert is enough;
-- INSERT ... ON CONFLICT DO UPDATE takes the row lock itself.
create function next_outlet_event_seq(p_outlet_id uuid) returns bigint
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_seq bigint;
begin
  insert into outlet_event_counters (outlet_id, next_seq)
  values (p_outlet_id, 2)
  on conflict (outlet_id) do update set next_seq = outlet_event_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  return v_seq;
end;
$$;
revoke execute on function next_outlet_event_seq(uuid) from public;
grant execute on function next_outlet_event_seq(uuid) to authenticated;

-- Realtime fast path (ADR-0005 §1/§4) — guarded for the docker-compose
-- bench DB, which has no Supabase stack at all (same pattern as 0015).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table order_status_events;
  end if;
end $$;
