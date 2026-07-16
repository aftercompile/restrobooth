-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- Phase 3b capability layer — same discipline as 0012 (menu) and 0014
-- (ordering). TENANCY.md §4's billing-relevant rows, the ones this phase
-- actually builds features for:
--   Day open/day close             -> org_owner/cluster_manager/outlet_manager
--   Void/refund a settled bill     -> org_owner/cluster_manager/outlet_manager
--   Apply discount > threshold     -> org_owner/cluster_manager/outlet_manager
--   Apply discount <= threshold    -> adds cashier
--   Settle a bill                  -> adds cashier (no new restriction needed —
--                                      already covered by existing scope RLS)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Day open/close. business_days had scope ISOLATION (0005) but no
-- CAPABILITY gate — any role with outlet access could open/close a day.
-- Mirrors can_authorize_void()'s shape exactly.
-- -----------------------------------------------------------------------------
create function can_manage_business_day(p_outlet_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from outlets o
    join memberships m on m.user_id = (select auth.uid())
    where o.id = p_outlet_id
      and m.role in ('org_owner','cluster_manager','outlet_manager')
      and (
           (m.scope_type = 'org'          and m.scope_id = o.org_id)
        or (m.scope_type = 'outlet'       and m.scope_id = o.id)
        or (m.scope_type = 'outlet_group' and m.scope_id in (
              select outlet_group_id from outlet_group_members where outlet_id = o.id))
      )
  );
$$;
revoke execute on function can_manage_business_day(uuid) from public;
grant execute on function can_manage_business_day(uuid) to authenticated;

create policy business_day_management_capability on business_days as restrictive for insert
  with check (can_manage_business_day(outlet_id));

create policy business_day_close_capability on business_days as restrictive for update
  using (can_manage_business_day(outlet_id));

-- -----------------------------------------------------------------------------
-- Void/refund a settled bill. bills has no separate "void request" row the
-- way order_item_voids does — voiding/refunding IS the status transition
-- (finalised -> voided, settled -> refunded_partial/refunded_full). A
-- RESTRICTIVE UPDATE policy is the right shape here (not a trigger): the
-- rule is "who may move this row to one of these three statuses," which a
-- USING clause expresses directly, with no column-scoping nuance the way
-- A6's price-vs-availability split needed a trigger for.
-- -----------------------------------------------------------------------------
create policy bill_void_refund_capability on bills as restrictive for update
  using (
    status not in ('voided','refunded_partial','refunded_full')
    or can_manage_business_day(outlet_id) -- same role set as day management
  );

-- -----------------------------------------------------------------------------
-- Discount threshold. TENANCY.md §4: cashier may apply a discount UP TO a
-- threshold; above it needs a manager. The threshold itself is a fixed
-- constant for v1 (ROADMAP.md's own scope note — no per-org settings table
-- exists to make it configurable, and adding one is a bigger decision than
-- this phase should make silently). 2000 bps = 20% of the bill's subtotal.
-- -----------------------------------------------------------------------------
create function enforce_bill_discount_capability() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  threshold_bps constant int := 2000; -- 20% — see migration header note
begin
  if new.subtotal_paise > 0 and new.discount_paise * 10000 > new.subtotal_paise * threshold_bps then
    if not can_manage_business_day(new.outlet_id) then
      raise exception 'insufficient privilege: a discount above % bps of subtotal requires a manager (outlet %)', threshold_bps, new.outlet_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger bill_discount_capability
  before insert on bills
  for each row execute function enforce_bill_discount_capability();

-- =============================================================================
-- Invoice number allocator (DOMAIN.md §6.3). A terminal always draws from a
-- block it holds — reserved, contiguous, row-locked at issuance so two
-- terminals can never receive overlapping ranges (the EXCLUDE USING GIST
-- constraint from 0006 is the hard backstop; this is what makes the
-- allocation itself race-free in the first place). Used identically online
-- or offline (ADR-0004: "no if(offline) branch anywhere") — Phase 3b's
-- online-only bill finalize already goes through this, not a shortcut.
-- =============================================================================

create function get_or_create_invoice_series(
  p_gst_registration_id uuid, p_outlet_id uuid, p_series_code text, p_financial_year text
) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from invoice_series
    where gst_registration_id = p_gst_registration_id and outlet_id = p_outlet_id
      and series_code = p_series_code and financial_year = p_financial_year
    for update;

  if v_id is null then
    insert into invoice_series (id, gst_registration_id, outlet_id, series_code, financial_year, next_seq)
    values (gen_random_uuid(), p_gst_registration_id, p_outlet_id, p_series_code, p_financial_year, 1)
    on conflict (gst_registration_id, outlet_id, series_code, financial_year) do nothing
    returning id into v_id;

    if v_id is null then
      -- lost the insert race to a concurrent caller — the row now exists, lock and read it.
      select id into v_id from invoice_series
        where gst_registration_id = p_gst_registration_id and outlet_id = p_outlet_id
          and series_code = p_series_code and financial_year = p_financial_year
        for update;
    end if;
  end if;

  return v_id;
end;
$$;
revoke execute on function get_or_create_invoice_series(uuid, uuid, text, text) from public;
grant execute on function get_or_create_invoice_series(uuid, uuid, text, text) to authenticated;

-- Reserves the next `p_block_size` sequence numbers as a new block for
-- `p_terminal_id`. Row-locks the series (FOR UPDATE inside
-- get_or_create_invoice_series) so the seq bump is atomic under concurrent
-- callers; the GIST exclude constraint on invoice_number_blocks is the
-- second, independent guarantee that two blocks can never overlap even if
-- this locking were somehow bypassed.
create function allocate_invoice_block(
  p_terminal_id uuid, p_gst_registration_id uuid, p_outlet_id uuid,
  p_series_code text, p_financial_year text, p_block_size int default 300
) returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_series_id uuid;
  v_start bigint;
  v_end bigint;
  v_block_id uuid;
begin
  v_series_id := get_or_create_invoice_series(p_gst_registration_id, p_outlet_id, p_series_code, p_financial_year);

  select next_seq into v_start from invoice_series where id = v_series_id for update;
  v_end := v_start + p_block_size - 1;
  update invoice_series set next_seq = v_end + 1 where id = v_series_id;

  v_block_id := gen_random_uuid();
  insert into invoice_number_blocks (id, invoice_series_id, terminal_id, start_seq, end_seq, next_seq, status)
  values (v_block_id, v_series_id, p_terminal_id, v_start, v_end, v_start, 'active');

  return v_block_id;
end;
$$;
revoke execute on function allocate_invoice_block(uuid, uuid, uuid, text, text, int) from public;
grant execute on function allocate_invoice_block(uuid, uuid, uuid, text, text, int) to authenticated;

-- Draws the next sequence number from the terminal's active block for this
-- series, auto-allocating a new block if none is active or the current one
-- is exhausted. Returns the raw seq — formatting into the final
-- "{SERIES}/{FY}/{SEQ}" string is packages/domain's formatInvoiceNumber(),
-- so there is exactly one place that knows the format, matching the
-- resolve_menu()-style "one call site" discipline this project already
-- uses for its other server-authoritative single-answer functions.
create function next_invoice_seq(
  p_terminal_id uuid, p_gst_registration_id uuid, p_outlet_id uuid,
  p_series_code text, p_financial_year text, p_block_size int default 300
) returns bigint
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_block_id uuid;
  v_next_seq bigint;
  v_end_seq bigint;
  v_seq bigint;
begin
  select b.id, b.next_seq, b.end_seq into v_block_id, v_next_seq, v_end_seq
    from invoice_number_blocks b
    join invoice_series s on s.id = b.invoice_series_id
    where b.terminal_id = p_terminal_id and b.status = 'active'
      and s.gst_registration_id = p_gst_registration_id and s.outlet_id = p_outlet_id
      and s.series_code = p_series_code and s.financial_year = p_financial_year
    order by b.issued_at desc
    limit 1
    for update;

  if v_block_id is null or v_next_seq > v_end_seq then
    if v_block_id is not null then
      update invoice_number_blocks set status = 'exhausted' where id = v_block_id;
    end if;
    v_block_id := allocate_invoice_block(p_terminal_id, p_gst_registration_id, p_outlet_id, p_series_code, p_financial_year, p_block_size);
    select next_seq, end_seq into v_next_seq, v_end_seq from invoice_number_blocks where id = v_block_id for update;
  end if;

  v_seq := v_next_seq;
  update invoice_number_blocks set next_seq = v_seq + 1 where id = v_block_id;
  return v_seq;
end;
$$;
revoke execute on function next_invoice_seq(uuid, uuid, uuid, text, text, int) from public;
grant execute on function next_invoice_seq(uuid, uuid, uuid, text, text, int) to authenticated;
