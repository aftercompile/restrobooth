-- Hand-edited after drizzle-kit generate: partitioning, composite PK/FK,
-- RLS, capability gate, and an amount-sanity trigger — same discipline as
-- 0020 (bill_lines). DOMAIN.md §3.4/§6.2: reversing a SETTLED bill never
-- edits or deletes it; it issues a credit note against its own numbering
-- series and moves the bill to refunded_partial/refunded_full. The
-- original invoice's number and content never change.

CREATE TABLE "credit_notes" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"bill_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"gst_registration_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"credit_note_no" text NOT NULL,
	"reason_code" text NOT NULL,
	"note" text,
	"amount_paise" bigint NOT NULL,
	"issued_by" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_note_amount_positive" CHECK ("credit_notes"."amount_paise" > 0),
	CONSTRAINT "credit_note_no_legal" CHECK (length("credit_notes"."credit_note_no") <= 16 and "credit_notes"."credit_note_no" ~ '^[A-Za-z0-9/-]+$'),
	CONSTRAINT "credit_note_reason_valid" CHECK ("credit_notes"."reason_code" in ('guest_dispute','billing_error','duplicate_payment','goodwill_gesture')),
	CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id","business_date")
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_gst_registration_id_gst_registrations_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_bill_id_fk"
	FOREIGN KEY ("bill_id","business_date") REFERENCES "public"."bills"("id","business_date") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
alter table credit_notes enable row level security;
--> statement-breakpoint
create policy credit_note_isolation on credit_notes for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

--> statement-breakpoint
-- Same role set as day management and bill void (TENANCY.md §4: "Void/refund
-- a settled bill" -> org_owner/cluster_manager/outlet_manager, not cashier).
create policy credit_note_issue_capability on credit_notes as restrictive for insert
  with check (can_manage_business_day(outlet_id));

--> statement-breakpoint
-- A credit note can never exceed what the guest actually paid — the one
-- cross-table invariant that a CHECK constraint can't express directly.
create function enforce_credit_note_amount() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_payable bigint;
begin
  select payable_paise into v_payable from bills where id = new.bill_id and business_date = new.business_date;
  if v_payable is null then
    raise exception 'credit note references unknown bill %', new.bill_id;
  end if;
  if new.amount_paise > v_payable then
    raise exception 'credit note amount % exceeds bill payable %', new.amount_paise, v_payable;
  end if;
  return new;
end;
$$;

create trigger credit_note_amount_sane
  before insert on credit_notes
  for each row execute function enforce_credit_note_amount();

--> statement-breakpoint
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
    'credit_notes'
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
