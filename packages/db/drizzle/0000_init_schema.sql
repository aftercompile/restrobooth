-- Local dev only: mirrors Supabase's auth schema (which already exists in
-- real Supabase, making this a no-op there too if ever run against it).
CREATE SCHEMA IF NOT EXISTS "auth";
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_kot_route_id" uuid
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "gst_registrations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"gstin" char(15) NOT NULL,
	"state_code" char(2) NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	CONSTRAINT "gst_registrations_gstin_unique" UNIQUE("gstin"),
	CONSTRAINT "gst_registrations_org_id_state_code_unique" UNIQUE("org_id","state_code"),
	CONSTRAINT "gstin_format" CHECK ("gst_registrations"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$'),
	CONSTRAINT "gstin_state_matches" CHECK ("gst_registrations"."state_code" = substring("gst_registrations"."gstin" from 1 for 2))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"pan" char(10),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlet_group_members" (
	"outlet_group_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	CONSTRAINT "outlet_group_members_outlet_group_id_outlet_id_pk" PRIMARY KEY("outlet_group_id","outlet_id")
);
--> statement-breakpoint
CREATE TABLE "outlet_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"gst_registration_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" char(3) NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"address" jsonb NOT NULL,
	"kind" text DEFAULT 'restaurant' NOT NULL,
	CONSTRAINT "outlets_org_id_code_unique" UNIQUE("org_id","code"),
	CONSTRAINT "outlet_kind_valid" CHECK ("outlets"."kind" in ('restaurant','cloud_kitchen','central_kitchen','warehouse'))
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "stores_brand_id_outlet_id_unique" UNIQUE("brand_id","outlet_id"),
	CONSTRAINT "store_status_valid" CHECK ("stores"."status" in ('active','paused','closed'))
);
--> statement-breakpoint
CREATE TABLE "tables" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"area_id" uuid NOT NULL,
	"label" text NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	CONSTRAINT "tables_outlet_id_label_unique" UNIQUE("outlet_id","label"),
	CONSTRAINT "table_status_valid" CHECK ("tables"."status" in ('available','out_of_service'))
);
--> statement-breakpoint
CREATE TABLE "terminals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"code" char(2) NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "terminals_outlet_id_code_unique" UNIQUE("outlet_id","code")
);
--> statement-breakpoint
-- Guarded, not a bare CREATE TABLE: against real Supabase, "auth" is owned
-- by supabase_auth_admin and "auth.users" already exists (managed by
-- GoTrue) with "postgres" holding no CREATE privilege in that schema at
-- all — an unguarded statement here doesn't no-op, it errors outright.
-- Skipping when the table already exists means the memberships FK below
-- correctly targets the REAL auth.users in that environment, which is the
-- behavior we actually want in production anyway.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM information_schema.tables
		WHERE table_schema = 'auth' AND table_name = 'users'
	) THEN
		CREATE TABLE "auth"."users" (
			"id" uuid PRIMARY KEY NOT NULL
		);
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_scope_type_scope_id_role_unique" UNIQUE("user_id","scope_type","scope_id","role"),
	CONSTRAINT "scope_type_valid" CHECK ("memberships"."scope_type" in ('org','brand','outlet_group','outlet')),
	CONSTRAINT "role_valid" CHECK ("memberships"."role" in ('org_owner','brand_manager','cluster_manager','outlet_manager','cashier','captain','kitchen'))
);
--> statement-breakpoint
CREATE TABLE "dayparts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"days_of_week" integer[] DEFAULT '{0,1,2,3,4,5,6}' NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "dayparts_brand_id_code_unique" UNIQUE("brand_id","code")
);
--> statement-breakpoint
CREATE TABLE "menu_item_overrides" (
	"id" uuid PRIMARY KEY NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"store_id" uuid,
	"channel_code" text,
	"daypart_id" uuid,
	"promo_id" uuid,
	"price_paise" bigint,
	"is_available" boolean,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	"publish_batch_id" uuid,
	"published_at" timestamp with time zone,
	CONSTRAINT "price_non_negative" CHECK ("menu_item_overrides"."price_paise" is null or "menu_item_overrides"."price_paise" >= 0),
	CONSTRAINT "override_status_valid" CHECK ("menu_item_overrides"."status" in ('draft','pending_approval','approved','published')),
	CONSTRAINT "overrides_something" CHECK ("menu_item_overrides"."price_paise" is not null or "menu_item_overrides"."is_available" is not null),
	CONSTRAINT "sane_dates" CHECK ("menu_item_overrides"."effective_to" is null or "menu_item_overrides"."effective_to" > "menu_item_overrides"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_price_paise" bigint NOT NULL,
	"tax_class_id" uuid NOT NULL,
	"diet" text,
	"allergens" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "base_price_non_negative" CHECK ("menu_items"."base_price_paise" >= 0),
	CONSTRAINT "diet_valid" CHECK ("menu_items"."diet" is null or "menu_items"."diet" in ('veg','non_veg','egg','jain')),
	CONSTRAINT "menu_item_status_valid" CHECK ("menu_items"."status" in ('draft','published','archived'))
);
--> statement-breakpoint
CREATE TABLE "promos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"status" text DEFAULT 'draft' NOT NULL,
	CONSTRAINT "promos_brand_id_code_unique" UNIQUE("brand_id","code"),
	CONSTRAINT "promo_status_valid" CHECK ("promos"."status" in ('draft','active','ended','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "tax_classes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"rate_bps" integer NOT NULL,
	CONSTRAINT "tax_classes_org_id_code_unique" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "business_days" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"status" text NOT NULL,
	"opened_by" uuid,
	"opened_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "business_days_outlet_id_business_date_unique" UNIQUE("outlet_id","business_date"),
	CONSTRAINT "business_day_status_valid" CHECK ("business_days"."status" in ('open','closed'))
);
--> statement-breakpoint
CREATE TABLE "kot_items" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"kot_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"prep_notes" text,
	CONSTRAINT "kot_items_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "kot_items_order_item_id_unique" UNIQUE ("order_item_id","business_date")
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "kots" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"table_session_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"kitchen_section" text NOT NULL,
	"kot_number" integer NOT NULL,
	"status" text NOT NULL,
	"reprint_count" integer DEFAULT 0 NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bumped_at" timestamp with time zone,
	"idempotency_key" uuid NOT NULL,
	CONSTRAINT "kots_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "kots_outlet_id_business_date_kot_number_unique" UNIQUE ("outlet_id","business_date","kot_number"),
	CONSTRAINT "kots_idempotency_key_unique" UNIQUE ("idempotency_key","business_date"),
	CONSTRAINT "kot_status_valid" CHECK ("status" in ('queued','printed','print_failed','acknowledged','preparing','ready','bumped','voided')),
	CONSTRAINT "kitchen_section_valid" CHECK ("kitchen_section" in ('hot','cold','bar'))
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "order_item_voids" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"order_item_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"quantity_voided" integer NOT NULL,
	"reason_code" text NOT NULL,
	"requires_auth" boolean NOT NULL,
	"authorized_by" uuid,
	"note" text,
	"voided_by" uuid NOT NULL,
	"voided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_voids_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "auth_required_check" CHECK ("requires_auth" = false OR ("requires_auth" = true AND "authorized_by" IS NOT NULL)),
	CONSTRAINT "quantity_voided_positive" CHECK ("quantity_voided" > 0),
	CONSTRAINT "void_reason_code_valid" CHECK ("reason_code" in ('guest_changed_mind','wrong_item_made','quality_complaint','staff_error'))
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"order_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"tax_class_id" uuid NOT NULL,
	"status" text NOT NULL,
	"client_line_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "order_items_order_id_client_line_id_unique" UNIQUE ("order_id","client_line_id","business_date"),
	CONSTRAINT "order_items_idempotency_key_unique" UNIQUE ("idempotency_key","business_date"),
	CONSTRAINT "quantity_positive" CHECK ("quantity" > 0),
	CONSTRAINT "unit_price_non_negative" CHECK ("unit_price_paise" >= 0),
	CONSTRAINT "order_item_status_valid" CHECK ("status" in ('pending','fired','served','void_requested','voided'))
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "order_status_events" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"outlet_id" uuid NOT NULL,
	"event_seq" bigint NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "order_status_events_outlet_id_event_seq_unique" UNIQUE ("outlet_id","event_seq","business_date"),
	CONSTRAINT "entity_type_valid" CHECK ("entity_type" in ('order','order_item','kot','table_session','bill'))
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"business_day_id" uuid NOT NULL,
	"table_session_id" uuid,
	"channel_code" text DEFAULT 'dinein' NOT NULL,
	"status" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE ("idempotency_key","business_date"),
	CONSTRAINT "order_status_valid" CHECK ("status" in ('open','billed','settled','voided','cancelled'))
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "outlet_event_counters" (
	"outlet_id" uuid PRIMARY KEY NOT NULL,
	"next_seq" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "table_session_tables" (
	"table_session_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	CONSTRAINT "table_session_tables_table_session_id_table_id_unique" UNIQUE("table_session_id","table_id")
);
--> statement-breakpoint
CREATE TABLE "table_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"business_day_id" uuid NOT NULL,
	"status" text NOT NULL,
	"merged_into_session_id" uuid,
	"covers" integer DEFAULT 1 NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"abandoned_reason" text,
	"idempotency_key" uuid NOT NULL,
	CONSTRAINT "table_sessions_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "table_session_status_valid" CHECK ("table_sessions"."status" in ('open','ordering','dining','bill_requested','settling','closed','abandoned','merged_into')),
	CONSTRAINT "merged_into_set_iff_status" CHECK (("table_sessions"."status" = 'merged_into' and "table_sessions"."merged_into_session_id" is not null) or ("table_sessions"."status" != 'merged_into' and "table_sessions"."merged_into_session_id" is null)),
	CONSTRAINT "abandoned_reason_required" CHECK (("table_sessions"."status" = 'abandoned' and "table_sessions"."abandoned_reason" is not null) or ("table_sessions"."status" != 'abandoned'))
);
--> statement-breakpoint
CREATE TABLE "bill_tax_lines" (
	"bill_id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"outlet_id" uuid NOT NULL,
	"tax_class_id" uuid NOT NULL,
	"component" text NOT NULL,
	"taxable_paise" bigint NOT NULL,
	"rate_bps" integer NOT NULL,
	"amount_paise" bigint NOT NULL,
	CONSTRAINT "bill_tax_lines_pkey" PRIMARY KEY ("bill_id","business_date","tax_class_id","component"),
	CONSTRAINT "tax_component_valid" CHECK ("bill_tax_lines"."component" in ('cgst','sgst','igst','cess'))
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"gst_registration_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"invoice_no" text,
	"status" text NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"charges_paise" bigint DEFAULT 0 NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"round_off_paise" bigint DEFAULT 0 NOT NULL,
	"payable_paise" bigint NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"finalised_at" timestamp with time zone,
	CONSTRAINT "invoice_no_legal" CHECK ("bills"."invoice_no" is null or (length("bills"."invoice_no") <= 16 and "bills"."invoice_no" ~ '^[A-Za-z0-9/-]+$')),
	CONSTRAINT "numbered_iff_finalised" CHECK (("bills"."status" = 'draft' and "bills"."invoice_no" is null) or ("bills"."status" = 'discarded' and "bills"."invoice_no" is null) or ("bills"."status" not in ('draft','discarded') and "bills"."invoice_no" is not null)),
	CONSTRAINT "payable_is_whole_rupees" CHECK ("bills"."payable_paise" % 100 = 0),
	CONSTRAINT "totals_reconcile" CHECK ("bills"."payable_paise" = "bills"."subtotal_paise" - "bills"."discount_paise" + "bills"."charges_paise" + "bills"."tax_paise" + "bills"."round_off_paise"),
	CONSTRAINT "bill_status_valid" CHECK ("bills"."status" in ('draft','finalised','settled','voided','refunded_partial','refunded_full','discarded')),
	CONSTRAINT "bills_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "bills_idempotency_key_unique" UNIQUE ("idempotency_key","business_date")
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "invoice_number_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_series_id" uuid NOT NULL,
	"terminal_id" uuid NOT NULL,
	"start_seq" bigint NOT NULL,
	"end_seq" bigint NOT NULL,
	"next_seq" bigint NOT NULL,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "end_after_start" CHECK ("invoice_number_blocks"."end_seq" >= "invoice_number_blocks"."start_seq"),
	CONSTRAINT "next_in_range" CHECK ("invoice_number_blocks"."next_seq" between "invoice_number_blocks"."start_seq" and "invoice_number_blocks"."end_seq" + 1),
	CONSTRAINT "block_status_valid" CHECK ("invoice_number_blocks"."status" in ('active','exhausted','returned'))
);
--> statement-breakpoint
CREATE TABLE "invoice_number_gaps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoice_series_id" uuid NOT NULL,
	"from_seq" bigint NOT NULL,
	"to_seq" bigint NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	CONSTRAINT "gap_reason_valid" CHECK ("invoice_number_gaps"."reason" in ('block_returned_unused','terminal_decommissioned','block_lost_device_failure','fy_rollover'))
);
--> statement-breakpoint
CREATE TABLE "invoice_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gst_registration_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"series_code" text NOT NULL,
	"financial_year" text NOT NULL,
	"next_seq" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_series_gst_registration_id_outlet_id_series_code_financial_year_unique" UNIQUE("gst_registration_id","outlet_id","series_code","financial_year")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid NOT NULL,
	"business_date" date NOT NULL,
	"bill_id" uuid NOT NULL,
	"outlet_id" uuid NOT NULL,
	"method" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"status" text NOT NULL,
	"gateway" text,
	"gateway_txn_id" text,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "amount_positive" CHECK ("payments"."amount_paise" > 0),
	CONSTRAINT "payment_method_valid" CHECK ("payments"."method" in ('cash','upi_intent','upi_collect','card','netbanking','wallet','pending_dues')),
	CONSTRAINT "payment_status_valid" CHECK ("payments"."status" in ('pending','captured','failed','refunded')),
	CONSTRAINT "payments_pkey" PRIMARY KEY ("id","business_date"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE ("idempotency_key","business_date")
) PARTITION BY RANGE ("business_date");
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"table_session_id" uuid,
	"store_id" uuid NOT NULL,
	"qr_token_id" uuid NOT NULL,
	"preferences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"rotates_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "qr_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "areas" ADD CONSTRAINT "areas_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gst_registrations" ADD CONSTRAINT "gst_registrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_group_members" ADD CONSTRAINT "outlet_group_members_outlet_group_id_outlet_groups_id_fk" FOREIGN KEY ("outlet_group_id") REFERENCES "public"."outlet_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_group_members" ADD CONSTRAINT "outlet_group_members_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_groups" ADD CONSTRAINT "outlet_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_gst_registration_id_gst_registrations_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tables" ADD CONSTRAINT "tables_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminals" ADD CONSTRAINT "terminals_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dayparts" ADD CONSTRAINT "dayparts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_overrides" ADD CONSTRAINT "menu_item_overrides_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_overrides" ADD CONSTRAINT "menu_item_overrides_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_overrides" ADD CONSTRAINT "menu_item_overrides_daypart_id_dayparts_id_fk" FOREIGN KEY ("daypart_id") REFERENCES "public"."dayparts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_item_overrides" ADD CONSTRAINT "menu_item_overrides_promo_id_promos_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_tax_class_id_tax_classes_id_fk" FOREIGN KEY ("tax_class_id") REFERENCES "public"."tax_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_classes" ADD CONSTRAINT "tax_classes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_days" ADD CONSTRAINT "business_days_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kot_items" ADD CONSTRAINT "kot_items_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kots" ADD CONSTRAINT "kots_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kots" ADD CONSTRAINT "kots_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kots" ADD CONSTRAINT "kots_table_session_id_table_sessions_id_fk" FOREIGN KEY ("table_session_id") REFERENCES "public"."table_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_voids" ADD CONSTRAINT "order_item_voids_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tax_class_id_tax_classes_id_fk" FOREIGN KEY ("tax_class_id") REFERENCES "public"."tax_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_day_id_business_days_id_fk" FOREIGN KEY ("business_day_id") REFERENCES "public"."business_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_table_session_id_table_sessions_id_fk" FOREIGN KEY ("table_session_id") REFERENCES "public"."table_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlet_event_counters" ADD CONSTRAINT "outlet_event_counters_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_session_tables" ADD CONSTRAINT "table_session_tables_table_session_id_table_sessions_id_fk" FOREIGN KEY ("table_session_id") REFERENCES "public"."table_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_session_tables" ADD CONSTRAINT "table_session_tables_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_business_day_id_business_days_id_fk" FOREIGN KEY ("business_day_id") REFERENCES "public"."business_days"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_tax_lines" ADD CONSTRAINT "bill_tax_lines_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_tax_lines" ADD CONSTRAINT "bill_tax_lines_tax_class_id_tax_classes_id_fk" FOREIGN KEY ("tax_class_id") REFERENCES "public"."tax_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_gst_registration_id_gst_registrations_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_number_blocks" ADD CONSTRAINT "invoice_number_blocks_invoice_series_id_invoice_series_id_fk" FOREIGN KEY ("invoice_series_id") REFERENCES "public"."invoice_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_number_blocks" ADD CONSTRAINT "invoice_number_blocks_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_number_gaps" ADD CONSTRAINT "invoice_number_gaps_invoice_series_id_invoice_series_id_fk" FOREIGN KEY ("invoice_series_id") REFERENCES "public"."invoice_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_gst_registration_id_gst_registrations_id_fk" FOREIGN KEY ("gst_registration_id") REFERENCES "public"."gst_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_series" ADD CONSTRAINT "invoice_series_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_table_session_id_table_sessions_id_fk" FOREIGN KEY ("table_session_id") REFERENCES "public"."table_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_qr_token_id_qr_tokens_id_fk" FOREIGN KEY ("qr_token_id") REFERENCES "public"."qr_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_tokens" ADD CONSTRAINT "qr_tokens_table_id_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "menu_item_overrides_lookup_idx" ON "menu_item_overrides" USING btree ("menu_item_id","status");--> statement-breakpoint
CREATE INDEX "menu_item_overrides_store_channel_idx" ON "menu_item_overrides" USING btree ("store_id","channel_code");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_day_per_outlet" ON "business_days" USING btree ("outlet_id") WHERE "business_days"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_txn_unique" ON "payments" USING btree ("gateway","gateway_txn_id","business_date") WHERE "payments"."gateway" IS NOT NULL AND "payments"."gateway_txn_id" IS NOT NULL;
--> statement-breakpoint

-- =============================================================================
-- Composite FKs between partitioned tables. A partitioned table's PK must
-- include its partition key (business_date), so any FK referencing it must
-- be composite too: (child_fk_col, business_date) REFERENCES parent (id, business_date).
-- Confirmed as the correct approach by the Day-1 spike (drizzle-kit generate
-- never touches the live DB, so hand-writing these causes no false drift).
-- =============================================================================
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fk"
	FOREIGN KEY ("order_id","business_date") REFERENCES "public"."orders"("id","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_voids" ADD CONSTRAINT "order_item_voids_order_item_id_fk"
	FOREIGN KEY ("order_item_id","business_date") REFERENCES "public"."order_items"("id","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kots" ADD CONSTRAINT "kots_order_id_fk"
	FOREIGN KEY ("order_id","business_date") REFERENCES "public"."orders"("id","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kot_items" ADD CONSTRAINT "kot_items_kot_id_fk"
	FOREIGN KEY ("kot_id","business_date") REFERENCES "public"."kots"("id","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kot_items" ADD CONSTRAINT "kot_items_order_item_id_fk"
	FOREIGN KEY ("order_item_id","business_date") REFERENCES "public"."order_items"("id","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_tax_lines" ADD CONSTRAINT "bill_tax_lines_bill_id_fk"
	FOREIGN KEY ("bill_id","business_date") REFERENCES "public"."bills"("id","business_date") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_fk"
	FOREIGN KEY ("bill_id","business_date") REFERENCES "public"."bills"("id","business_date") ON DELETE no action ON UPDATE no action;