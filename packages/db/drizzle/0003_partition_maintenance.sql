-- Custom SQL migration file, put your code below! --

-- docs/ERD.md §6 / docs/adr/0002-data-retention.md. Partitions are created
-- three months ahead by a scheduled job; a missing partition is an outage
-- (inserts fail), so this is idempotent and safe to call from both the
-- initial migration and a recurring cron. months_back covers seed/test
-- history without needing a separate backfill script.
create function create_partitions_ahead(months_back int default 1, months_ahead int default 3)
returns void
language plpgsql
as $$
declare
  tbl text;
  offset_month int;
  target_month date;
  partition_name text;
  start_bound date;
  end_bound date;
begin
  for tbl in select unnest(array[
    'orders', 'order_items', 'order_item_voids', 'kots', 'kot_items',
    'order_status_events', 'bills', 'bill_tax_lines', 'payments'
  ]) loop
    for offset_month in -months_back..months_ahead loop
      target_month := (date_trunc('month', now()) + (offset_month || ' months')::interval)::date;
      partition_name := tbl || '_' || to_char(target_month, 'YYYY_MM');
      start_bound := target_month;
      end_bound := (target_month + interval '1 month')::date;

      if not exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where c.relname = partition_name and n.nspname = 'public'
      ) then
        execute format(
          'create table %I partition of %I for values from (%L) to (%L)',
          partition_name, tbl, start_bound, end_bound
        );
        -- CRITICAL: enabling RLS on a partitioned parent does NOT propagate
        -- to child partitions (confirmed empirically — this was a real,
        -- silent RLS bypass in this project before this fix). A partition's
        -- POLICIES are inherited from the parent automatically; only the
        -- relrowsecurity on/off switch is not, and must be set per-partition.
        -- Without this, `SELECT * FROM orders_2026_07` directly returns
        -- every outlet's rows regardless of the caller's RLS scope, even
        -- though querying through the parent `orders` correctly filters.
        execute format('alter table %I enable row level security', partition_name);
      end if;
    end loop;
  end loop;
end;
$$;

-- Initial window for Phase 1 dev/seed: a year back (the believable-chain
-- seed backdates some order history) through 3 months ahead.
select create_partitions_ahead(12, 3);
