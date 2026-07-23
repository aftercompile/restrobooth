-- Hand-written, same discipline as 0029/0021/0020: partitioning, composite
-- PK, RLS, and the create_partitions_ahead() re-declare aren't things
-- drizzle-kit generate can produce, so this file is hand-authored rather
-- than generated-then-edited. Phase 6 Slice 1 (ADR-0007) — the AI spine's
-- persistent state: a per-outlet token budget, an append-only usage
-- ledger, a response cache, and the structural SELECT-only AI role.

-- ADR-0007 §4 — "an outlet cannot generate an unbounded bill." NOT NULL
-- with a real default: an outlet is bounded from the moment it's
-- provisioned, not only once someone remembers to configure it.
ALTER TABLE "outlets" ADD COLUMN "ai_monthly_token_budget" integer DEFAULT 500000 NOT NULL;--> statement-breakpoint

CREATE TABLE "ai_usage_ledger" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid,
	"feature" text NOT NULL,
	"provider_id" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_ledger_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "ai_usage_feature_valid" CHECK ("ai_usage_ledger"."feature" in ('booth_host','upsell','review_extraction','menu_engineering','forecasting','ask_restrobooth','content_studio')),
	CONSTRAINT "ai_usage_tokens_non_negative" CHECK ("ai_usage_ledger"."input_tokens" >= 0 and "ai_usage_ledger"."output_tokens" >= 0)
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint

ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_ledger" ADD CONSTRAINT "ai_usage_ledger_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

alter table ai_usage_ledger enable row level security;
--> statement-breakpoint
-- Same shape as payment_isolation/credit_note_isolation/feedback_isolation
-- — "for all", not "for select": a staff-triggered AI feature (menu
-- engineering, review extraction) records its own usage row through the
-- SAME queryAsCurrentUser/RLS-scoped connection the rest of that request
-- runs on, so INSERT needs to be allowed too, not just staff-side reads
-- for a future budget dashboard. A guest-triggered feature (Booth Host)
-- goes through the privileged connection instead (ADR-0009), which
-- bypasses RLS entirely as it already does for every other guest write.
-- store_id is nullable (an outlet-level feature like Ask RestroBooth may
-- not be store-scoped), so unlike the store-scoped tables above, a null
-- store_id is explicitly allowed through rather than silently excluded.
create policy ai_usage_ledger_isolation on ai_usage_ledger for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and (store_id is null or store_id in (select accessible_store_ids()))
  );

--> statement-breakpoint
-- Not partitioned: keyed by hash, naturally self-limiting in row count
-- (menu_version/preference-vector cardinality is small, ADR-0007 §5), and
-- expiresAt is a plain cleanup filter, not a query-pattern that benefits
-- from range partitioning the way business-date event tables do.
CREATE TABLE "ai_response_cache" (
	"cache_key" text PRIMARY KEY NOT NULL,
	"feature" text NOT NULL,
	"response" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- No RLS-based tenant access here: the cache holds no tenant-scoped data
-- by itself (the hash key already encodes store_id; a cache HIT still
-- only ever reaches a guest through the normal store-scoped code path
-- that computed the key). Only the AI role and the privileged connection
-- ever touch this table.
alter table ai_response_cache enable row level security;
--> statement-breakpoint
-- No policies at all = no access except the table owner / superuser and
-- roles the AI code path connects as directly (not through PostgREST).
-- Deliberately closed by default rather than open-with-a-catch.

--> statement-breakpoint
-- ADR-0007 §6 — "no AI-produced value is ever written to bills, payments,
-- order_items, stock_ledger, or any tax field," enforced by a DISTINCT
-- DATABASE ROLE with SELECT only, on an allowlisted view layer, not by
-- convention in application code. Created here, structurally, before any
-- feature exists to use it — Slice 2 (Booth Host) is the first to GRANT
-- SELECT on a specific view to this role; until then it can read nothing.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_readonly') then
    create role ai_readonly nologin noinherit;
  end if;
end;
$$;
--> statement-breakpoint
grant usage on schema public to ai_readonly;
-- Deliberately NO "grant select on all tables" — the whole point of this
-- role is that it can read nothing until a specific view is allowlisted
-- for it, one GRANT per feature, reviewed at the point it's added.

--> statement-breakpoint
-- Re-declare with "ai_usage_ledger" added to the partitioned-table list
-- (see 0003's header — idempotent/replaceable by design for exactly this:
-- a new partitioned table joins the array, same pattern 0029 used for
-- "feedback").
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
    'credit_notes', 'feedback', 'ai_usage_ledger'
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
