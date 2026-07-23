import { pgTable, uuid, text, date, integer, bigint, timestamp, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { outlets, stores } from "./tenancy.js";

// ADR-0007 §4 — a per-outlet monthly token budget, enforced server-side
// BEFORE the call is made (packages/ai's budgetGuard.ts), never after. An
// append-only ledger, one row per AI call: the running total for "has this
// outlet used its budget this month" is a SUM over this table, not a
// separately-maintained counter — the same "derive, don't cache" shape
// order_status_events already uses for KDS reconnection. Partitioned by
// business_date, same convention as every other business-event table (see
// create_partitions_ahead's list, drizzle/0003).
export const aiUsageLedger = pgTable(
  "ai_usage_ledger",
  {
    id: uuid("id").notNull(),
    businessDate: date("business_date").notNull(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    storeId: uuid("store_id").references(() => stores.id),
    // ADR-0007 §5's cache keys and §1's feature list — a closed set, not
    // free text, so a typo can't silently create an unbudgeted bucket.
    feature: text("feature").notNull(),
    providerId: text("provider_id").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    // Paise, computed from the provider's costPer1kTokens at call time and
    // stored — an audit trail that survives future pricing changes, same
    // reasoning bill_tax_lines freezes its rate at bill time rather than
    // re-deriving it from the tax_classes table later.
    costPaise: bigint("cost_paise", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.businessDate] }),
    check(
      "ai_usage_feature_valid",
      sql`${t.feature} in ('booth_host','upsell','review_extraction','menu_engineering','forecasting','ask_restrobooth','content_studio')`,
    ),
    check("ai_usage_tokens_non_negative", sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0`),
  ],
);

// ADR-0007 §5 — response cache keyed on a content hash (e.g.
// hash(preference_vector, store_id, menu_version) for the Booth Host).
// Postgres, not a new cache infra dependency — same "reuse what's already
// here" call idempotency_keys already made. `expiresAt` is deliberately
// short (menu_version already invalidates on publish; this is a safety net
// against an unbounded table, not the primary invalidation mechanism).
export const aiResponseCache = pgTable("ai_response_cache", {
  cacheKey: text("cache_key").primaryKey(),
  feature: text("feature").notNull(),
  response: text("response").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
