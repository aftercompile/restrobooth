CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_user_id" uuid NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_entity_type_valid" CHECK ("menu_audit_log"."entity_type" in ('menu_item','menu_item_override'))
);
--> statement-breakpoint
CREATE TABLE "option_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"menu_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"min_select" integer DEFAULT 0 NOT NULL,
	"max_select" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "option_group_kind_valid" CHECK ("option_groups"."kind" in ('variant','addon')),
	CONSTRAINT "select_bounds_sane" CHECK ("option_groups"."min_select" >= 0 and "option_groups"."max_select" >= "option_groups"."min_select"),
	CONSTRAINT "variant_is_pick_exactly_one" CHECK ("option_groups"."kind" != 'variant' or ("option_groups"."min_select" = 1 and "option_groups"."max_select" = 1))
);
--> statement-breakpoint
CREATE TABLE "option_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"option_group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price_paise" bigint NOT NULL,
	"is_available" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "option_item_price_non_negative" CHECK ("option_items"."price_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_audit_log" ADD CONSTRAINT "menu_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "option_items" ADD CONSTRAINT "option_items_option_group_id_option_groups_id_fk" FOREIGN KEY ("option_group_id") REFERENCES "public"."option_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_audit_log_entity_idx" ON "menu_audit_log" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;