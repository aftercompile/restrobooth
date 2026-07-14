import { pgTable, uuid, text, bigint, boolean, integer, timestamp, jsonb, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { brands } from "./tenancy.js";
import { authUsers } from "./access.js";
import { menuItems } from "./menu.js";

// Brand-scoped, like menuItems itself (TENANCY.md §7). A category is
// organisational only — it carries no pricing or availability meaning,
// so it is never a dimension in resolve_menu()'s specificity chain.
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
);

// "variant" = pick exactly one (Half/Full, Regular/Large) — its price
// REPLACES the item's base price for that order line, it does not add to
// it. "addon" = pick zero or more within [minSelect, maxSelect] — its
// price ADDS to the line, matching DOMAIN.md §5's existing
// `line_gross = unit_price × qty + Σ(addon_price × addon_qty)` formula.
// No per-store/channel/daypart/promo overrides on either in this phase —
// see the Phase 2 plan's explicit scope cut; adding that later is a new
// sparse-override table shaped like menu_item_overrides, not a rewrite.
export const optionGroups = pgTable(
  "option_groups",
  {
    id: uuid("id").primaryKey(),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id),
    kind: text("kind").notNull(),
    name: text("name").notNull(), // "Size", "Extra Toppings"
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    check("option_group_kind_valid", sql`${t.kind} in ('variant','addon')`),
    check("select_bounds_sane", sql`${t.minSelect} >= 0 and ${t.maxSelect} >= ${t.minSelect}`),
    // A variant group is "pick exactly one" by definition — that's what
    // makes it a variant rather than an addon group with maxSelect=1.
    check(
      "variant_is_pick_exactly_one",
      sql`${t.kind} != 'variant' or (${t.minSelect} = 1 and ${t.maxSelect} = 1)`,
    ),
  ],
);

export const optionItems = pgTable(
  "option_items",
  {
    id: uuid("id").primaryKey(),
    optionGroupId: uuid("option_group_id")
      .notNull()
      .references(() => optionGroups.id),
    name: text("name").notNull(), // "Half", "Extra Cheese"
    pricePaise: bigint("price_paise", { mode: "bigint" }).notNull(),
    isAvailable: boolean("is_available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [check("option_item_price_non_negative", sql`${t.pricePaise} >= 0`)],
);

// Append-only, never partitioned, never updated or deleted after insert
// (TENANCY.md §7.5: "who, when, from -> to, old value -> new value").
// entityType/entityId are a loose polymorphic reference (no FK — the
// entity table varies) rather than one nullable FK column per possible
// entity type.
export const menuAuditLog = pgTable(
  "menu_audit_log",
  {
    id: uuid("id").primaryKey(),
    entityType: text("entity_type").notNull(), // 'menu_item' | 'menu_item_override'
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(), // 'create' | 'update' | 'publish' | 'set_availability'
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => authUsers.id),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("audit_entity_type_valid", sql`${t.entityType} in ('menu_item','menu_item_override')`),
    index("menu_audit_log_entity_idx").on(t.entityType, t.entityId, t.createdAt),
  ],
);
