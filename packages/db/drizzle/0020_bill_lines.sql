-- Hand-edited after drizzle-kit generate: partitioning, composite PK/FKs,
-- and RLS follow the same pattern as bills/bill_tax_lines/payments (0000,
-- 0005). drizzle-kit has no primitive for PARTITION BY or composite FKs.
--
-- Real Phase 3b gap found while building the invoice view: nothing snapshot
-- which order_items belong to a bill, or what they were named/priced at
-- billing time. getBillableLines() re-derives from LIVE order_items by
-- table_session_id, which (a) breaks once a session can have more than one
-- bill (split-bill, this same slice) and (b) would let a later menu-item
-- rename silently change the content of an already-issued invoice — the
-- same "printed invoice number is immutable" principle applies to content,
-- not just the number.

CREATE TABLE "bill_lines" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"bill_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"name" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"tax_class_id" uuid NOT NULL,
	"tax_rate_bps" integer NOT NULL,
	CONSTRAINT "bill_line_quantity_positive" CHECK ("bill_lines"."quantity" > 0),
	CONSTRAINT "bill_line_unit_price_non_negative" CHECK ("bill_lines"."unit_price_paise" >= 0),
	CONSTRAINT "bill_lines_pkey" PRIMARY KEY ("id","business_date")
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_tax_class_id_tax_classes_id_fk" FOREIGN KEY ("tax_class_id") REFERENCES "public"."tax_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_fk"
	FOREIGN KEY ("bill_id","business_date") REFERENCES "public"."bills"("id","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_order_item_id_fk"
	FOREIGN KEY ("order_item_id","business_date") REFERENCES "public"."order_items"("id","business_date") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- RLS: mirrors bill_tax_lines exactly (outlet-scoped isolation only). Rows
-- are only ever written inside the same transaction as the bills insert
-- they belong to, which already passed bill_take_capability/
-- bill_discount_capability — there is no independent write path to gate.
alter table bill_lines enable row level security;
--> statement-breakpoint
create policy bill_line_isolation on bill_lines for all
  using (outlet_id in (select accessible_outlet_ids()));

--> statement-breakpoint
-- Register bill_lines with the partition-maintenance function (0003) and
-- create its partitions for the already-materialized window immediately —
-- create_partitions_ahead() is idempotent, so re-running it only adds the
-- partitions this table is missing.
create or replace function create_partitions_ahead(months_back int default 1, months_ahead int default 3)
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
    'order_status_events', 'bills', 'bill_tax_lines', 'bill_lines', 'payments'
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
        execute format('alter table %I enable row level security', partition_name);
      end if;
    end loop;
  end loop;
end;
$$;

select create_partitions_ahead(12, 3);
