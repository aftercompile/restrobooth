-- packages/db/bench/generators/bulk_fact_data.sql
--
-- Set-based bulk generation of the fact tables (orders/order_items/kots/
-- kot_items/bills/bill_tax_lines/payments) for the BENCHMARKS.md fixture.
-- Reads the dimension data dimensions.ts already seeded (outlets, stores,
-- menu_items, tax_classes) directly via joins — no parameters describing
-- structure, only scale knobs. Inserts land directly in the per-month
-- CHILD partition (e.g. orders_2026_07), never through the parent, per
-- BENCHMARKS.md's explicit technique and the Day-1 spike's finding that
-- this is the only way to avoid partition-routing overhead at this volume.
--
-- Money math: real menu_item prices/tax classes (not synthetic flat
-- values) — round-half-up per tax component, matching DOMAIN.md §5,
-- computed the same way in SQL here as in TS in the believable-chain seed.
-- totals_reconcile and payable_is_whole_rupees hold by construction: both
-- sides of the constraint are computed from the same aggregated numbers.

-- Per-store precomputed brand item arrays: avoids a per-row subquery/sort
-- at 9M-row scale (a LATERAL...ORDER BY random() LIMIT 1 per row would not
-- finish in reasonable time). Index into the array with cheap arithmetic
-- instead.
create or replace function bench_store_items()
returns table (store_id uuid, item_ids uuid[], item_prices bigint[], item_tax_classes uuid[])
language sql stable
as $$
  select s.id,
         array_agg(mi.id order by mi.id),
         array_agg(mi.base_price_paise order by mi.id),
         array_agg(mi.tax_class_id order by mi.id)
  from stores s
  join menu_items mi on mi.brand_id = s.brand_id
  group by s.id;
$$;

create or replace function bench_outlet_stores()
returns table (outlet_id uuid, store_ids uuid[])
language sql stable
as $$
  select outlet_id, array_agg(id order by id) from stores group by outlet_id;
$$;

-- Generates one month's worth of fact rows directly into that month's
-- child partitions. Called in a loop by generate_bench_fixture() below.
create or replace function generate_bench_month(
  p_month_start date,
  p_month_end date,        -- exclusive
  p_orders_per_outlet_per_day int,
  p_items_min int,
  p_items_max int
) returns void
language plpgsql
as $$
declare
  suffix text := to_char(p_month_start, 'YYYY_MM');
begin
  -- ORDERS: one row per (outlet, day, order-index). Store picked by
  -- indexing into that outlet's store array — deterministic-cheap, not a
  -- per-row subquery.
  execute format($f$
    insert into %I (id, business_date, outlet_id, store_id, business_day_id, channel_code, status, idempotency_key, created_at)
    select
      gen_random_uuid(),
      d.business_date,
      os.outlet_id,
      os.store_ids[1 + ((n * 2654435761) %% array_length(os.store_ids, 1))::int],
      bd.id,
      (array['dinein','zomato','swiggy','ondc','direct','captain'])[1 + (n %% 6)],
      'settled',
      gen_random_uuid(),
      d.business_date::timestamptz + (n %% 14 + 1) * interval '1 hour'
    from bench_outlet_stores() os
    cross join generate_series(%L::date, %L::date - interval '1 day', interval '1 day') d(business_date)
    cross join generate_series(1, %s) n
    join business_days bd on bd.outlet_id = os.outlet_id and bd.business_date = d.business_date::date
  $f$, 'orders_' || suffix, p_month_start, p_month_end, p_orders_per_outlet_per_day);

  -- TABLE_SESSIONS: one per order, reusing the order's own id as the
  -- session id (table_sessions is NOT partitioned — see docs/ERD.md §4.1 —
  -- so this is a plain, non-dynamic insert). Exists purely to satisfy
  -- kots.table_session_id's FK below; BENCH-01/02's query set never reads
  -- table_sessions itself, so a 1:1-with-order shortcut is fine here.
  execute format($f$
    insert into table_sessions (id, outlet_id, store_id, business_day_id, status, covers, opened_at, closed_at, idempotency_key)
    select o.id, o.outlet_id, o.store_id, o.business_day_id, 'closed', 2, o.created_at, o.created_at + interval '40 minutes', gen_random_uuid()
    from %I o
  $f$, 'orders_' || suffix);

  -- ORDER_ITEMS: 2-4 per order, real menu items from that order's store,
  -- indexed into the precomputed per-store array.
  execute format($f$
    insert into %I (id, business_date, order_id, outlet_id, store_id, menu_item_id, quantity, unit_price_paise, tax_class_id, status, client_line_id, idempotency_key, created_at)
    select
      gen_random_uuid(), o.business_date, o.id, o.outlet_id, o.store_id,
      si.item_ids[1 + ((k * 40503 + 7) %% array_length(si.item_ids, 1))::int],
      1 + (k %% 3),
      si.item_prices[1 + ((k * 40503 + 7) %% array_length(si.item_ids, 1))::int],
      si.item_tax_classes[1 + ((k * 40503 + 7) %% array_length(si.item_ids, 1))::int],
      'served', gen_random_uuid(), gen_random_uuid(), o.created_at
    from %I o
    join bench_store_items() si on si.store_id = o.store_id
    cross join generate_series(1, %s + (('x' || substr(o.id::text, 1, 4))::bit(16)::int %% (%s - %s + 1))) k
  $f$, 'order_items_' || suffix, 'orders_' || suffix, p_items_min, p_items_max, p_items_min);

  -- KOTS: one per order (Phase 1 fixture simplification — no multi-section
  -- splitting; that's a Phase 3a feature-correctness concern, not a
  -- performance-fixture one).
  execute format($f$
    insert into %I (id, business_date, outlet_id, store_id, table_session_id, order_id, kitchen_section, kot_number, status, fired_at, bumped_at, idempotency_key)
    select
      gen_random_uuid(), o.business_date, o.outlet_id, o.store_id, o.id, o.id,
      (array['hot','cold','bar'])[1 + (('x' || substr(o.id::text,1,4))::bit(16)::int %% 3)],
      row_number() over (partition by o.outlet_id, o.business_date order by o.created_at),
      'bumped', o.created_at, o.created_at + interval '12 minutes', gen_random_uuid()
    from %I o
  $f$, 'kots_' || suffix, 'orders_' || suffix);
  -- table_session_id = order.id here is a deliberate fixture shortcut
  -- (skips seeding a real table_sessions row per order at this volume);
  -- kots.table_session_id has no FK to a real session as a result. This is
  -- fine for BENCH-01/02's query set (neither reads table_sessions), but
  -- means this table cannot be used to test table_sessions behaviour.

  execute format($f$
    insert into %I (id, business_date, kot_id, order_item_id, outlet_id, quantity)
    select gen_random_uuid(), oi.business_date, k.id, oi.id, oi.outlet_id, oi.quantity
    from %I oi
    join %I k on k.order_id = oi.order_id
  $f$, 'kot_items_' || suffix, 'order_items_' || suffix, 'kots_' || suffix);

  -- BILLS: aggregate order_items per order, real component-wise tax,
  -- round-half-up, matching DOMAIN.md §5 exactly.
  execute format($f$
    with line_agg as (
      select
        order_id, business_date, outlet_id, store_id, tax_class_id,
        sum(unit_price_paise * quantity) as taxable
      from %I
      group by order_id, business_date, outlet_id, store_id, tax_class_id
    ),
    tax_by_class as (
      select
        la.order_id, la.business_date, la.outlet_id, la.store_id,
        la.tax_class_id, la.taxable,
        round(la.taxable * tc.rate_bps / 2 / 10000.0) as cgst,
        round(la.taxable * tc.rate_bps / 2 / 10000.0) as sgst
      from line_agg la
      join tax_classes tc on tc.id = la.tax_class_id
    ),
    bill_agg as (
      select
        order_id, business_date, outlet_id, store_id,
        sum(taxable) as subtotal,
        sum(cgst + sgst) as tax
      from tax_by_class
      group by order_id, business_date, outlet_id, store_id
    )
    insert into %I (id, business_date, outlet_id, store_id, gst_registration_id, terminal_id, invoice_no, status, subtotal_paise, discount_paise, charges_paise, tax_paise, round_off_paise, payable_paise, idempotency_key, finalised_at)
    select
      o.id, ba.business_date, ba.outlet_id, ba.store_id, out.gst_registration_id,
      bt.terminal_id,
      -- CGST Rule 46(b): invoice_no <= 16 chars. 'B'+YYMM(4)+seq(6) = 11.
      'B' || to_char(ba.business_date, 'YYMM') || lpad((row_number() over (partition by ba.outlet_id order by ba.business_date))::text, 6, '0'),
      'settled',
      ba.subtotal, 0, 0, ba.tax,
      (round((ba.subtotal + ba.tax) / 100.0) * 100 - (ba.subtotal + ba.tax)),
      round((ba.subtotal + ba.tax) / 100.0) * 100,
      gen_random_uuid(), o.created_at
    from bill_agg ba
    join %I o on o.id = ba.order_id
    join outlets out on out.id = ba.outlet_id
    join (select distinct on (outlet_id) outlet_id, id as terminal_id from terminals order by outlet_id, id) bt
      on bt.outlet_id = ba.outlet_id
  $f$, 'order_items_' || suffix, 'bills_' || suffix, 'orders_' || suffix);

  -- PAYMENTS: one per bill, cash, captured.
  execute format($f$
    insert into %I (id, business_date, bill_id, outlet_id, store_id, method, amount_paise, status, idempotency_key, created_at)
    select gen_random_uuid(), b.business_date, b.id, b.outlet_id, b.store_id, 'cash', b.payable_paise, 'captured', gen_random_uuid(), b.finalised_at
    from %I b
  $f$, 'payments_' || suffix, 'bills_' || suffix);
end;
$$;

-- bills needs a real terminal_id (FK). dimensions.ts deliberately doesn't
-- seed terminals (that script is scoped to tenancy/menu/users) — ensure
-- one exists per outlet before any month's bill generation runs. Plain,
-- idempotent, no per-row cleverness needed at this row count (20 rows).
insert into terminals (id, outlet_id, code, name)
select gen_random_uuid(), o.id, 'B1', 'Bench Terminal'
from outlets o
where not exists (select 1 from terminals t where t.outlet_id = o.id);

-- business_days for the whole window — the one prerequisite every month's
-- orders join against. Deliberately a SEPARATE, one-shot call from
-- bench/seed.ts (not looped inside a single PL/pgSQL function alongside
-- the fact-table generation): a PL/pgSQL function body cannot COMMIT
-- mid-execution, so a 12-month loop inside one function is ONE
-- multi-million-row transaction — invisible to any other session until
-- the whole thing finishes (no progress visibility), and if row 8,000,000
-- fails, every prior month's work rolls back too. Calling
-- generate_bench_month() once per month as separate top-level statements
-- from TS gives each month its own transaction — bounded WAL, real
-- progress visibility, and a failed month doesn't cost the ones before it.
create or replace function generate_bench_business_days(p_months_back int)
returns void
language plpgsql
as $$
begin
  insert into business_days (id, outlet_id, business_date, status)
  select gen_random_uuid(), o.id, d::date, 'closed'
  from outlets o
  cross join generate_series(
    (date_trunc('month', now()) - (p_months_back || ' months')::interval)::date,
    (now())::date - 1,
    interval '1 day'
  ) d
  on conflict (outlet_id, business_date) do nothing;

  insert into business_days (id, outlet_id, business_date, status, opened_at)
  select gen_random_uuid(), o.id, now()::date, 'open', now()
  from outlets o
  on conflict (outlet_id, business_date) do nothing;
end;
$$;
