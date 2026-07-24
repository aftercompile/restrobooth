import { pgTable, uuid, text, date, integer, boolean, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { outlets, stores } from "./tenancy.js";
import { menuItems } from "./menu.js";
import { authUsers } from "./access.js";

/**
 * Phase 6 Slice 4 (RESTROBOOTH_BRIEF.md §5B) — a staff-pasted aggregator
 * review (Zomato/Swiggy/Google/other). Not partitioned: a sibling of
 * ai_response_cache, not a business-event table — review volume is staff-
 * paced, not transaction-paced, and `reviewed_on` gives the report's time
 * axis without needing physical partitioning.
 */
export const externalReviews = pgTable(
  "external_reviews",
  {
    id: uuid("id").primaryKey(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    sourcePlatform: text("source_platform").notNull(),
    externalRating: integer("external_rating"),
    authorLabel: text("author_label"),
    reviewText: text("review_text").notNull(),
    reviewedOn: date("reviewed_on"),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    extractionAiUsed: boolean("extraction_ai_used").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => authUsers.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("external_review_platform_valid", sql`${t.sourcePlatform} in ('zomato','swiggy','google','other')`),
    check("external_review_rating_valid", sql`${t.externalRating} is null or ${t.externalRating} between 1 and 5`),
  ],
);

/**
 * The brief's own "typed table" — one row per (source review × aspect
 * finding), not jsonb-on-source, so §5C (Menu Engineering) and this
 * slice's own trend/"3 things to fix" queries can group/aggregate
 * relationally. Every aspect/sentiment is a closed set and every
 * menu_item_id is a REAL resolvable dish or null — never a name the model
 * invented (packages/ai/src/reviewExtraction.ts's dish matcher is what
 * enforces this before a row is ever written here).
 */
export const reviewExtractions = pgTable(
  "review_extractions",
  {
    id: uuid("id").primaryKey(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    sourceType: text("source_type").notNull(),
    externalReviewId: uuid("external_review_id").references(() => externalReviews.id),
    // composite FK -> feedback(id, business_date) — feedback is partitioned
    // by business_date, same pattern bill_lines.orderItemId uses for
    // order_items.
    feedbackId: uuid("feedback_id"),
    feedbackBusinessDate: date("feedback_business_date"),
    aspect: text("aspect").notNull(),
    sentiment: text("sentiment").notNull(),
    menuItemId: uuid("menu_item_id").references(() => menuItems.id),
    snippet: text("snippet").notNull(),
    aiUsed: boolean("ai_used").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("review_extraction_source_valid", sql`${t.sourceType} in ('guest_feedback','external_review')`),
    check(
      "review_extraction_source_exclusive",
      sql`(${t.externalReviewId} is not null)::int + (${t.feedbackId} is not null)::int = 1`,
    ),
    check(
      "review_extraction_aspect_valid",
      sql`${t.aspect} in ('taste','portion','temperature','wait','price','service')`,
    ),
    check("review_extraction_sentiment_valid", sql`${t.sentiment} in ('positive','neutral','negative')`),
  ],
);
