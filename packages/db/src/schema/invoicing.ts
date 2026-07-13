import {
  pgTable,
  uuid,
  text,
  date,
  bigint,
  integer,
  timestamp,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { outlets, terminals } from "./tenancy.js";
import { gstRegistrations } from "./tenancy.js";
import { stores } from "./tenancy.js";
import { taxClasses } from "./menu.js";

export const invoiceSeries = pgTable(
  "invoice_series",
  {
    id: uuid("id").primaryKey(),
    gstRegistrationId: uuid("gst_registration_id")
      .notNull()
      .references(() => gstRegistrations.id),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    seriesCode: text("series_code").notNull(), // 'A1', 'A1T2', 'A1CN'
    financialYear: text("financial_year").notNull(), // '2627' = FY Apr 2026 – Mar 2027
    nextSeq: bigint("next_seq", { mode: "bigint" }).notNull().default(sql`1`),
  },
  (t) => [unique().on(t.gstRegistrationId, t.outletId, t.seriesCode, t.financialYear)],
);

// Reserved contiguous ranges for offline terminals. The non-overlap
// guarantee (`exclude using gist`) is hand-written SQL — Drizzle has no
// exclusion-constraint primitive. See drizzle/0005_invoice_numbering.sql.
export const invoiceNumberBlocks = pgTable(
  "invoice_number_blocks",
  {
    id: uuid("id").primaryKey(),
    invoiceSeriesId: uuid("invoice_series_id")
      .notNull()
      .references(() => invoiceSeries.id),
    terminalId: uuid("terminal_id")
      .notNull()
      .references(() => terminals.id),
    startSeq: bigint("start_seq", { mode: "bigint" }).notNull(),
    endSeq: bigint("end_seq", { mode: "bigint" }).notNull(),
    nextSeq: bigint("next_seq", { mode: "bigint" }).notNull(),
    status: text("status").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("end_after_start", sql`${t.endSeq} >= ${t.startSeq}`),
    check(
      "next_in_range",
      sql`${t.nextSeq} between ${t.startSeq} and ${t.endSeq} + 1`,
    ),
    check(
      "block_status_valid",
      sql`${t.status} in ('active','exhausted','returned')`,
    ),
    // EXCLUDE USING GIST (invoice_series_id, int8range(start_seq, end_seq, '[]')):
    // added by hand-written SQL. Blocks can never overlap — enforced by
    // Postgres, not application code.
  ],
);

// Auditors ask about gaps. This is the answer. Never partitioned, never archived.
export const invoiceNumberGaps = pgTable(
  "invoice_number_gaps",
  {
    id: uuid("id").primaryKey(),
    invoiceSeriesId: uuid("invoice_series_id")
      .notNull()
      .references(() => invoiceSeries.id),
    fromSeq: bigint("from_seq", { mode: "bigint" }).notNull(),
    toSeq: bigint("to_seq", { mode: "bigint" }).notNull(),
    reason: text("reason").notNull(),
    recordedBy: uuid("recorded_by"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [
    check(
      "gap_reason_valid",
      sql`${t.reason} in ('block_returned_unused','terminal_decommissioned','block_lost_device_failure','fy_rollover')`,
    ),
  ],
);

// Partitioned (business_date, monthly). Column shape only — see operations.ts
// header note for the Half A / Half B split.
export const bills = pgTable(
  "bills",
  {
    id: uuid("id").notNull(),
    businessDate: date("business_date").notNull(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id),
    gstRegistrationId: uuid("gst_registration_id")
      .notNull()
      .references(() => gstRegistrations.id),
    terminalId: uuid("terminal_id")
      .notNull()
      .references(() => terminals.id),
    invoiceNo: text("invoice_no"), // NULL while draft; assigned at finalise
    status: text("status").notNull(),

    subtotalPaise: bigint("subtotal_paise", { mode: "bigint" }).notNull(),
    discountPaise: bigint("discount_paise", { mode: "bigint" }).notNull().default(sql`0`),
    chargesPaise: bigint("charges_paise", { mode: "bigint" }).notNull().default(sql`0`),
    taxPaise: bigint("tax_paise", { mode: "bigint" }).notNull().default(sql`0`),
    roundOffPaise: bigint("round_off_paise", { mode: "bigint" }).notNull().default(sql`0`), // SIGNED
    payablePaise: bigint("payable_paise", { mode: "bigint" }).notNull(),

    idempotencyKey: uuid("idempotency_key").notNull(),
    finalisedAt: timestamp("finalised_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "invoice_no_legal", // CGST Rule 46(b): <=16 chars, alphanumeric + - /
      sql`${t.invoiceNo} is null or (length(${t.invoiceNo}) <= 16 and ${t.invoiceNo} ~ '^[A-Za-z0-9/-]+$')`,
    ),
    check(
      "numbered_iff_finalised",
      sql`(${t.status} = 'draft' and ${t.invoiceNo} is null) or (${t.status} = 'discarded' and ${t.invoiceNo} is null) or (${t.status} not in ('draft','discarded') and ${t.invoiceNo} is not null)`,
    ),
    check("payable_is_whole_rupees", sql`${t.payablePaise} % 100 = 0`),
    check(
      "totals_reconcile",
      sql`${t.payablePaise} = ${t.subtotalPaise} - ${t.discountPaise} + ${t.chargesPaise} + ${t.taxPaise} + ${t.roundOffPaise}`,
    ),
    check(
      "bill_status_valid",
      sql`${t.status} in ('draft','finalised','settled','voided','refunded_partial','refunded_full','discarded')`,
    ),
  ],
);

export const billTaxLines = pgTable(
  "bill_tax_lines",
  {
    billId: uuid("bill_id").notNull(), // composite FK -> bills(id, business_date)
    businessDate: date("business_date").notNull(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    taxClassId: uuid("tax_class_id")
      .notNull()
      .references(() => taxClasses.id),
    component: text("component").notNull(),
    taxablePaise: bigint("taxable_paise", { mode: "bigint" }).notNull(),
    rateBps: integer("rate_bps").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
  },
  (t) => [
    check("tax_component_valid", sql`${t.component} in ('cgst','sgst','igst','cess')`),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").notNull(),
    businessDate: date("business_date").notNull(),
    billId: uuid("bill_id").notNull(), // composite FK -> bills(id, business_date)
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id), // denormalized for RLS (partitioned tables can't join through bills in a policy)
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id), // same A8 concern as orders/bills
    method: text("method").notNull(),
    amountPaise: bigint("amount_paise", { mode: "bigint" }).notNull(),
    status: text("status").notNull(),
    gateway: text("gateway"),
    gatewayTxnId: text("gateway_txn_id"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("amount_positive", sql`${t.amountPaise} > 0`),
    check(
      "payment_method_valid",
      sql`${t.method} in ('cash','upi_intent','upi_collect','card','netbanking','wallet','pending_dues')`,
    ),
    check("payment_status_valid", sql`${t.status} in ('pending','captured','failed','refunded')`),
  ],
);
