CREATE TABLE "terminal_day_drawers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_day_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"opening_float_paise" bigint DEFAULT 0 NOT NULL,
	"counted_paise" bigint,
	"variance_paise" bigint,
	"variance_note" text,
	"opened_by" uuid NOT NULL,
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	CONSTRAINT "terminal_day_drawers_business_day_id_terminal_id_unique" UNIQUE("business_day_id","terminal_id")
);
--> statement-breakpoint
ALTER TABLE "terminal_day_drawers" ADD CONSTRAINT "terminal_day_drawers_business_day_id_business_days_id_fk" FOREIGN KEY ("business_day_id") REFERENCES "public"."business_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_day_drawers" ADD CONSTRAINT "terminal_day_drawers_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminal_day_drawers" ADD CONSTRAINT "terminal_day_drawers_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
-- Half B (hand-written): scope isolation + the same day-management
-- capability gate as business_days itself (drizzle/0016) — a drawer is
-- opened/counted by the same role set that opens/closes the day it
-- belongs to.
alter table terminal_day_drawers enable row level security;

create policy terminal_day_drawer_isolation on terminal_day_drawers for all
  using (outlet_id in (select accessible_outlet_ids()));

create policy terminal_day_drawer_management_capability on terminal_day_drawers as restrictive for insert
  with check (can_manage_business_day(outlet_id));

create policy terminal_day_drawer_close_capability on terminal_day_drawers as restrictive for update
  using (can_manage_business_day(outlet_id));