import {
  pgTable,
  uuid,
  text,
  bigint,
  boolean,
  timestamp,
  time,
  integer,
  unique,
  check,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, brands } from "./tenancy.js";
import { stores } from "./tenancy.js";
import { categories } from "./catalog.js";

export const taxClasses = pgTable(
  "tax_classes",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(), // 'FOOD_5', 'GOODS_18'
    rateBps: integer("rate_bps").notNull(), // basis points: 500 = 5%
  },
  (t) => [unique().on(t.orgId, t.code)],
);

// Brand-scoped (TENANCY.md §7.3 dimension D). A daypart's window is local
// wall-clock time at the outlet; days_of_week: 0=Sunday..6=Saturday.
export const dayparts = pgTable(
  "dayparts",
  {
    id: uuid("id").primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    code: text("code").notNull(), // 'happy_hour', 'breakfast'
    name: text("name").notNull(),
    daysOfWeek: integer("days_of_week")
      .array()
      .notNull()
      .default(sql`'{0,1,2,3,4,5,6}'`),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [unique().on(t.brandId, t.code)],
);

// Brand-scoped (TENANCY.md §7.3 dimension P). The campaign shell; the actual
// price/availability effect lives on menu_item_overrides rows that key on it.
export const promos = pgTable(
  "promos",
  {
    id: uuid("id").primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    code: text("code").notNull(), // 'MONSOON20'
    name: text("name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
  },
  (t) => [
    unique().on(t.brandId, t.code),
    check("promo_status_valid", sql`${t.status} in ('draft','active','ended','cancelled')`),
  ],
);

// DEFINED ONCE, AT BRAND LEVEL (TENANCY.md §7). The `embedding vector(384)`
// column (Booth Host, Phase 6) is added via hand-written SQL alongside the
// pgvector extension — Drizzle has no native vector column type.
export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    // categories lives in catalog.ts, which itself imports menuItems (for
    // optionGroups.menuItemId) — a genuine circular import between the two
    // files. Safe here: .references() takes a thunk specifically so
    // Drizzle can resolve it lazily, after both modules finish
    // initializing, not at pgTable()-construction time. Nullable: not
    // every item needs a category on day one.
    categoryId: uuid("category_id").references((): AnyPgColumn => categories.id),
    name: text("name").notNull(),
    description: text("description"),
    basePricePaise: bigint("base_price_paise", { mode: "bigint" }).notNull(),
    taxClassId: uuid("tax_class_id")
      .notNull()
      .references(() => taxClasses.id),
    diet: text("diet"),
    allergens: text("allergens")
      .array()
      .notNull()
      .default(sql`'{}'`),
    // Phase 6 Slice 2 (ADR-0007 §5A, the Booth Host) — real SQL filters,
    // not LLM-guessed: spiceLevel narrows the shortlist directly,
    // tags (occasion/mood/texture descriptors — "comfort", "shareable",
    // "light", "spicy-regional", ...) are a soft ranking signal and also
    // feed the reason-string prompt. Both nullable/empty by default:
    // an untagged item still resolves normally through diet/allergen/
    // budget/popularity, it just can't be spice- or mood-matched yet.
    spiceLevel: text("spice_level"),
    tags: text("tags").array().notNull().default(sql`'{}'`),
    status: text("status").notNull().default("draft"),
    // Which kitchen line cooks this item — decides KOT routing at fire time
    // (DOMAIN.md §3.3, Phase 3a). A single "fire" produces one KOT per
    // distinct section the order touches. Defaults to 'hot': the common
    // case, and a safe fallback for an unclassified item (it prints
    // somewhere a human sees it rather than vanishing).
    kitchenSection: text("kitchen_section").notNull().default("hot"),
  },
  (t) => [
    check("base_price_non_negative", sql`${t.basePricePaise} >= 0`),
    check("diet_valid", sql`${t.diet} is null or ${t.diet} in ('veg','non_veg','egg','jain')`),
    check("spice_level_valid", sql`${t.spiceLevel} is null or ${t.spiceLevel} in ('mild','medium','hot')`),
    check("menu_item_status_valid", sql`${t.status} in ('draft','published','archived')`),
    check("kitchen_section_valid", sql`${t.kitchenSection} in ('hot','cold','bar')`),
  ],
);

// SPARSE overrides — never a duplicated menu. See docs/TENANCY.md §7. The
// generated `specificity` column and its partial index are hand-written SQL
// (Drizzle has no generated-column primitive) — see
// drizzle/0006_menu_specificity_and_resolver.sql.
export const menuItemOverrides = pgTable(
  "menu_item_overrides",
  {
    id: uuid("id").primaryKey(),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id),
    storeId: uuid("store_id").references(() => stores.id), // dimension S (weight 1)
    channelCode: text("channel_code"), // dimension C (weight 2)
    daypartId: uuid("daypart_id").references(() => dayparts.id), // dimension D (weight 4)
    promoId: uuid("promo_id").references(() => promos.id), // dimension P (weight 8)
    pricePaise: bigint("price_paise", { mode: "bigint" }), // null = don't override price
    isAvailable: boolean("is_available"), // null = don't override availability
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),
    status: text("status").notNull().default("draft"),
    publishBatchId: uuid("publish_batch_id"), // staged rollout: roll back as a unit
    publishedAt: timestamp("published_at", { withTimezone: true }),
  },
  (t) => [
    index("menu_item_overrides_lookup_idx").on(t.menuItemId, t.status),
    index("menu_item_overrides_store_channel_idx").on(t.storeId, t.channelCode),
    check("price_non_negative", sql`${t.pricePaise} is null or ${t.pricePaise} >= 0`),
    check(
      "override_status_valid",
      sql`${t.status} in ('draft','pending_approval','approved','published')`,
    ),
    check("overrides_something", sql`${t.pricePaise} is not null or ${t.isAvailable} is not null`),
    check(
      "sane_dates",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} > ${t.effectiveFrom}`,
    ),
  ],
);
