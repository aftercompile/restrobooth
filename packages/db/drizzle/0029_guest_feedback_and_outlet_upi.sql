-- Hand-edited after drizzle-kit generate: partitioning, composite PK, RLS
-- — same discipline as 0020/0021. Phase 5 Slice 3: one feedback row per
-- visit (rating required, comment free text for Phase 6's later
-- aspect/sentiment extraction — not analyzed here). Written via the guest
-- privileged connection (ADR-0009's pattern), so the unique constraint on
-- (table_session_id, business_date) is the real duplicate-submit guard.

CREATE TABLE "feedback" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"table_session_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "feedback_table_session_id_business_date_unique" UNIQUE("table_session_id","business_date"),
	CONSTRAINT "feedback_rating_valid" CHECK ("feedback"."rating" between 1 and 5)
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint

-- Phase 5 Slice 3: the merchant UPI address a guest's upi://pay deep link
-- pays into. Nullable — an outlet with no VPA simply doesn't offer the UPI
-- method in the Booth (checked at the call site, not enforced here).
ALTER TABLE "outlets" ADD COLUMN "upi_vpa" text;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "upi_payee_name" text;--> statement-breakpoint

ALTER TABLE "feedback" ADD CONSTRAINT "feedback_table_session_id_table_sessions_id_fk" FOREIGN KEY ("table_session_id") REFERENCES "public"."table_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
alter table feedback enable row level security;
--> statement-breakpoint
-- Same shape as payment_isolation/credit_note_isolation — staff read/write
-- scoped to their outlet+store. No anon grant: the guest write goes
-- through the privileged connection (ADR-0009), never through this policy.
create policy feedback_isolation on feedback for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

--> statement-breakpoint
-- Re-declare with "feedback" added to the partitioned-table list (see
-- 0003's header — this function is idempotent/replaceable by design for
-- exactly this reason: a new partitioned table joins the array, same
-- pattern 0021_credit_notes.sql used to add credit_notes).
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
    'order_status_events', 'bills', 'bill_tax_lines', 'bill_lines', 'payments',
    'credit_notes', 'feedback'
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
