import {
  pgTable,
  uuid,
  text,
  date,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  unique,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { outlets, stores, tables } from "./tenancy.js";
import { menuItems, taxClasses } from "./menu.js";

export const businessDays = pgTable(
  "business_days",
  {
    id: uuid("id").primaryKey(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    businessDate: date("business_date").notNull(),
    status: text("status").notNull(),
    openedBy: uuid("opened_by"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedBy: uuid("closed_by"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    unique().on(t.outletId, t.businessDate),
    // THE enforcement mechanism for "one open day at a time" (DOMAIN.md §4).
    uniqueIndex("one_open_day_per_outlet")
      .on(t.outletId)
      .where(sql`${t.status} = 'open'`),
    check("business_day_status_valid", sql`${t.status} in ('open','closed')`),
  ],
);

// Backs the per-outlet monotonic event_seq that ADR-0005's gap-detection
// depends on. A single global sequence would NOT work here — other
// outlets' events would appear as gaps to a client watching only one outlet.
export const outletEventCounters = pgTable("outlet_event_counters", {
  outletId: uuid("outlet_id")
    .primaryKey()
    .references(() => outlets.id),
  nextSeq: bigint("next_seq", { mode: "bigint" }).notNull().default(sql`1`),
});

// NOT partitioned — volume is real but was never called out as a
// partitioned table in docs/ERD.md §6 / ADR-0002's retention table.
// Deliberate call, flagged at the Phase 1 schema checkpoint; revisit via a
// future ADR if volume becomes a real problem.
export const tableSessions = pgTable(
  "table_sessions",
  {
    id: uuid("id").primaryKey(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id), // merges are blocked across stores (DOMAIN.md §3.1)
    businessDayId: uuid("business_day_id")
      .notNull()
      .references(() => businessDays.id),
    status: text("status").notNull(),
    mergedIntoSessionId: uuid("merged_into_session_id"), // self-ref, see (t) =>
    covers: integer("covers").notNull().default(1),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    abandonedReason: text("abandoned_reason"),
    idempotencyKey: uuid("idempotency_key").notNull(),
  },
  (t) => [
    unique().on(t.idempotencyKey),
    check(
      "table_session_status_valid",
      sql`${t.status} in ('open','ordering','dining','bill_requested','settling','closed','abandoned','merged_into')`,
    ),
    check(
      "merged_into_set_iff_status",
      sql`(${t.status} = 'merged_into' and ${t.mergedIntoSessionId} is not null) or (${t.status} != 'merged_into' and ${t.mergedIntoSessionId} is null)`,
    ),
    check(
      "abandoned_reason_required",
      sql`(${t.status} = 'abandoned' and ${t.abandonedReason} is not null) or (${t.status} != 'abandoned')`,
    ),
    // BENCH-01 Q4 (floor map) found this table had NO index beyond its PK
    // — every "sessions for outlet X, today" query was a full sequential
    // scan, p95 up to 43x over threshold even with RLS bypassed entirely.
    index("table_sessions_outlet_opened_idx").on(t.outletId, t.openedAt),
  ],
);

// A party occupying one or more tables (DOMAIN.md §1). Modelled as a proper
// join table rather than an array column — array columns can't carry a
// referential-integrity guarantee against `tables`.
export const tableSessionTables = pgTable(
  "table_session_tables",
  {
    tableSessionId: uuid("table_session_id")
      .notNull()
      .references(() => tableSessions.id),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id),
  },
  (t) => [unique().on(t.tableSessionId, t.tableId)],
);

// ---------------------------------------------------------------------------
// Partitioned tables (business_date, monthly). Plain column shape only —
// PARTITION BY RANGE, composite PKs, and cross-partitioned-table FKs are
// hand-written SQL (drizzle/0003_operations_partitioned.sql). Confirmed safe
// by the Day-1 spike: `drizzle-kit generate` never re-derives drift from the
// live DB, only from its own snapshot history.
// ---------------------------------------------------------------------------

export const orders = pgTable("orders", {
  id: uuid("id").notNull(),
  businessDate: date("business_date").notNull(),
  outletId: uuid("outlet_id")
    .notNull()
    .references(() => outlets.id),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
  businessDayId: uuid("business_day_id")
    .notNull()
    .references(() => businessDays.id),
  tableSessionId: uuid("table_session_id").references(() => tableSessions.id),
  channelCode: text("channel_code").notNull().default("dinein"),
  status: text("status").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").notNull(),
  businessDate: date("business_date").notNull(),
  orderId: uuid("order_id").notNull(), // composite FK -> orders(id, business_date), hand-written
  outletId: uuid("outlet_id")
    .notNull()
    .references(() => outlets.id), // denormalized for RLS (see docs/TENANCY.md §5)
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
  menuItemId: uuid("menu_item_id")
    .notNull()
    .references(() => menuItems.id),
  quantity: integer("quantity").notNull(),
  unitPricePaise: bigint("unit_price_paise", { mode: "bigint" }).notNull(),
  taxClassId: uuid("tax_class_id")
    .notNull()
    .references(() => taxClasses.id),
  status: text("status").notNull(),
  clientLineId: uuid("client_line_id").notNull(), // offline dedup: (order_id, client_line_id)
  idempotencyKey: uuid("idempotency_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only void ledger (DOMAIN.md §3.2). The original order_items row is
// NEVER edited; a quantity reduction is a new negative-quantity-equivalent
// row here referencing the original.
export const orderItemVoids = pgTable("order_item_voids", {
  id: uuid("id").notNull(),
  businessDate: date("business_date").notNull(), // = the original order_item's business_date
  orderItemId: uuid("order_item_id").notNull(), // composite FK -> order_items(id, business_date)
  outletId: uuid("outlet_id")
    .notNull()
    .references(() => outlets.id),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id), // denormalized for RLS — same A8 concern as order_items
  quantityVoided: integer("quantity_voided").notNull(),
  reasonCode: text("reason_code").notNull(),
  requiresAuth: boolean("requires_auth").notNull(), // true if the item had already fired
  authorizedBy: uuid("authorized_by"),
  note: text("note"),
  voidedBy: uuid("voided_by").notNull(),
  voidedAt: timestamp("voided_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kots = pgTable(
  "kots",
  {
    id: uuid("id").notNull(),
    businessDate: date("business_date").notNull(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id), // KOTs are OUTLET-scoped — a shared kitchen shows every store's tickets
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id), // informational: which brand this ticket belongs to (display tagging only)
    tableSessionId: uuid("table_session_id")
      .notNull()
      .references(() => tableSessions.id),
    orderId: uuid("order_id").notNull(), // composite FK -> orders(id, business_date)
    kitchenSection: text("kitchen_section").notNull(),
    kotNumber: integer("kot_number").notNull(), // per outlet, per business day, resets daily
    status: text("status").notNull(),
    reprintCount: integer("reprint_count").notNull().default(0),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(), // ticket-age clock (DOMAIN.md §3.3)
    bumpedAt: timestamp("bumped_at", { withTimezone: true }),
    idempotencyKey: uuid("idempotency_key").notNull(),
  },
  (t) => [
    // BENCH-01 Q3 (KDS): "active KOTs for an outlet, last 4h" had no
    // index on fired_at at all — p95 ~200ms against a 30ms threshold,
    // even with RLS bypassed. A plain btree index on a partitioned
    // PARENT propagates automatically to every child partition, including
    // ones created later by create_partitions_ahead() — unlike RLS's
    // relrowsecurity flag, which does not (see drizzle/0003).
    index("kots_outlet_fired_idx").on(t.outletId, t.firedAt),
  ],
);

export const kotItems = pgTable("kot_items", {
  id: uuid("id").notNull(),
  businessDate: date("business_date").notNull(),
  kotId: uuid("kot_id").notNull(), // composite FK -> kots(id, business_date)
  orderItemId: uuid("order_item_id").notNull(), // composite FK -> order_items(id, business_date)
  outletId: uuid("outlet_id")
    .notNull()
    .references(() => outlets.id),
  quantity: integer("quantity").notNull(),
  prepNotes: text("prep_notes"),
});

// The generic append-only event log ADR-0005's KDS reconnect logic reads.
export const orderStatusEvents = pgTable("order_status_events", {
  id: uuid("id").notNull(),
  businessDate: date("business_date").notNull(),
  outletId: uuid("outlet_id")
    .notNull()
    .references(() => outlets.id),
  eventSeq: bigint("event_seq", { mode: "bigint" }).notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
