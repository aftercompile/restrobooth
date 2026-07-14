import {
  pgTable,
  uuid,
  text,
  char,
  jsonb,
  integer,
  timestamp,
  unique,
  check,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// See docs/TENANCY.md §1. Outlet = a place. Store = a brand selling at a place.

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  pan: char("pan", { length: 10 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gstRegistrations = pgTable(
  "gst_registrations",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    gstin: char("gstin", { length: 15 }).notNull(),
    stateCode: char("state_code", { length: 2 }).notNull(),
    legalName: text("legal_name").notNull(),
    tradeName: text("trade_name"),
  },
  (t) => [
    unique().on(t.gstin),
    unique().on(t.orgId, t.stateCode), // ONE GSTIN PER STATE PER ENTITY
    check(
      "gstin_format",
      sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$'`,
    ),
    check("gstin_state_matches", sql`${t.stateCode} = substring(${t.gstin} from 1 for 2)`),
  ],
);

export const brands = pgTable(
  "brands",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
  },
  (t) => [unique().on(t.slug)],
);

export const outlets = pgTable(
  "outlets",
  {
    id: uuid("id").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id),
    gstRegistrationId: uuid("gst_registration_id")
      .notNull()
      .references(() => gstRegistrations.id),
    name: text("name").notNull(),
    code: char("code", { length: 3 }).notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    address: jsonb("address").notNull(),
    kind: text("kind").notNull().default("restaurant"),
  },
  (t) => [
    unique().on(t.orgId, t.code),
    check(
      "outlet_kind_valid",
      sql`${t.kind} in ('restaurant','cloud_kitchen','central_kitchen','warehouse')`,
    ),
    // INVARIANT (enforced by trigger, see 0002_tenancy_triggers.sql): the outlet's
    // GSTIN must be registered in the outlet's own state.
  ],
);

// A BRAND SELLING AT A PLACE — the sellable unit. Orders, bills, menus attach here.
export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    status: text("status").notNull().default("active"),
  },
  (t) => [
    unique().on(t.brandId, t.outletId), // exactly one store per (brand, outlet)
    check("store_status_valid", sql`${t.status} in ('active','paused','closed')`),
  ],
);

// Floor-plan grouping only. NOT a tenancy/access-control concept (TENANCY.md §2 Case C).
export const areas = pgTable("areas", {
  id: uuid("id").primaryKey(),
  outletId: uuid("outlet_id")
    .notNull()
    .references(() => outlets.id),
  name: text("name").notNull(),
  defaultKotRouteId: uuid("default_kot_route_id"),
});

// The physical floor table. A cash drawer belongs to a TERMINAL, not a table or
// an outlet directly (TENANCY.md §2 Case C) — that distinction is what lets one
// outlet run two terminals off one kitchen.
export const tables = pgTable(
  "tables",
  {
    id: uuid("id").primaryKey(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    areaId: uuid("area_id")
      .notNull()
      .references(() => areas.id),
    label: text("label").notNull(),
    capacity: integer("capacity").notNull().default(4),
    status: text("status").notNull().default("available"),
  },
  (t) => [
    unique().on(t.outletId, t.label),
    check("table_status_valid", sql`${t.status} in ('available','out_of_service')`),
  ],
);

export const terminals = pgTable(
  "terminals",
  {
    id: uuid("id").primaryKey(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    code: char("code", { length: 2 }).notNull(),
    name: text("name").notNull(),
  },
  (t) => [unique().on(t.outletId, t.code)],
);

// Arbitrary bag of outlets — clusters, pilot cohorts. NOT part of the ownership
// tree, which is exactly what lets it express a cluster manager's subset.
export const outletGroups = pgTable("outlet_groups", {
  id: uuid("id").primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
});

export const outletGroupMembers = pgTable(
  "outlet_group_members",
  {
    outletGroupId: uuid("outlet_group_id")
      .notNull()
      .references(() => outletGroups.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
  },
  (t) => [
    primaryKey({ columns: [t.outletGroupId, t.outletId] }),
    // BENCHMARKS.md's own escalation-ladder step 1, applied proactively:
    // accessible_outlet_ids()'s outlet_group branch looks this table up by
    // outlet_id, but the composite PK leads with outlet_group_id — an
    // outlet_id-first index is what actually serves that lookup.
    index("outlet_group_members_outlet_id_idx").on(t.outletId),
  ],
);
