-- Hand-edited after drizzle-kit generate: composite FK, RLS, and dropping
-- a duplicate ALTER follow the same discipline as 0020/0021/0029/0032.
-- Phase 6 Slice 4 (RESTROBOOTH_BRIEF.md §5B) — the review→action pipeline.
--
-- external_reviews / review_extractions are deliberately NOT partitioned
-- by business_date: they're analytical/derived tables (siblings of
-- ai_response_cache), not business-event tables — review volume is
-- staff-paced, not transaction-paced, and reviewed_on/created_at already
-- give the report its time axis without physical partitioning. Neither
-- joins create_partitions_ahead() below.
--
-- The generated diff also proposed re-adding menu_items.image_url — that
-- column was already added by 0034 (a hand-authored "custom SQL" migration
-- whose snapshot never recorded it, a pre-existing drift, not introduced
-- here). Dropped from this file; harmless to fix going forward since this
-- migration's own snapshot now includes it.

CREATE TABLE "external_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"source_platform" text NOT NULL,
	"external_rating" integer,
	"author_label" text,
	"review_text" text NOT NULL,
	"reviewed_on" date,
	"extracted_at" timestamp with time zone,
	"extraction_ai_used" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_review_platform_valid" CHECK ("external_reviews"."source_platform" in ('zomato','swiggy','google','other')),
	CONSTRAINT "external_review_rating_valid" CHECK ("external_reviews"."external_rating" is null or "external_reviews"."external_rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "review_extractions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"outlet_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"external_review_id" uuid,
	"feedback_id" uuid,
	"feedback_business_date" date,
	"aspect" text NOT NULL,
	"sentiment" text NOT NULL,
	"menu_item_id" uuid,
	"snippet" text NOT NULL,
	"ai_used" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_extraction_source_valid" CHECK ("review_extractions"."source_type" in ('guest_feedback','external_review')),
	CONSTRAINT "review_extraction_source_exclusive" CHECK (("review_extractions"."external_review_id" is not null)::int + ("review_extractions"."feedback_id" is not null)::int = 1),
	CONSTRAINT "review_extraction_aspect_valid" CHECK ("review_extractions"."aspect" in ('taste','portion','temperature','wait','price','service')),
	CONSTRAINT "review_extraction_sentiment_valid" CHECK ("review_extractions"."sentiment" in ('positive','neutral','negative'))
);
--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "extracted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feedback" ADD COLUMN "extraction_ai_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "external_reviews" ADD CONSTRAINT "external_reviews_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reviews" ADD CONSTRAINT "external_reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_reviews" ADD CONSTRAINT "external_reviews_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_extractions" ADD CONSTRAINT "review_extractions_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_extractions" ADD CONSTRAINT "review_extractions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_extractions" ADD CONSTRAINT "review_extractions_external_review_id_external_reviews_id_fk" FOREIGN KEY ("external_review_id") REFERENCES "public"."external_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_extractions" ADD CONSTRAINT "review_extractions_menu_item_id_menu_items_id_fk" FOREIGN KEY ("menu_item_id") REFERENCES "public"."menu_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Composite FK to feedback's real (id, business_date) PK — feedback is
-- partitioned, same pattern bill_lines.order_item_id uses for order_items
-- (drizzle/0020_bill_lines.sql). drizzle-kit's generated diff can't emit
-- this (no composite-FK primitive), hence hand-added.
ALTER TABLE "review_extractions" ADD CONSTRAINT "review_extractions_feedback_id_fk"
	FOREIGN KEY ("feedback_id","feedback_business_date") REFERENCES "public"."feedback"("id","business_date") ON DELETE no action ON UPDATE no action;

--> statement-breakpoint
alter table external_reviews enable row level security;
--> statement-breakpoint
create policy external_review_isolation on external_reviews for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

--> statement-breakpoint
alter table review_extractions enable row level security;
--> statement-breakpoint
create policy review_extraction_isolation on review_extractions for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );
