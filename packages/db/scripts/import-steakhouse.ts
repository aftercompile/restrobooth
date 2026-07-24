/**
 * `pnpm --filter @restrobooth/db import:steakhouse` — Phase 6 Slice 0.
 *
 * Seeds a real, believable-volume outlet ("Ember & Oak", Mumbai — Bandra
 * West) for the AI/reporting features to validate against, per
 * docs/adr/0007-ai-provider.md and the Phase 6 replan
 * (C:\Users\Mohammed\.claude\plans\phase-0-merry-pie.md). Source: an
 * owner-provided simulated steakhouse POS export (12 items, US-priced,
 * a year of line-item sales, no order/session grouping, no tax data) —
 * re-branded to an Indian premium grill per the owner's explicit call
 * (DECISIONS.md, 2026-07-23).
 *
 * This is a GENERATOR, not a literal CSV parser: the source file arrived
 * as text pasted into a chat, not a real uploaded file, and was too large
 * (several thousand rows) to mechanically retype into a file without
 * enormous, error-prone transcription. Instead this reproduces the real
 * dataset's SHAPE — the exact 12 items and price spread, the 5
 * payment-method/order-type/day-of-week/hour-of-day patterns actually
 * observed — as a seeded, deterministic, re-runnable generator. See
 * DECISIONS.md for the full reasoning and the two owner decisions this
 * required (currency/re-branding, and this generator-vs-transcription
 * call).
 *
 * Deliberately LOCAL/DEV ONLY — this is demo/AI-testing fixture data, not
 * real business data, and has no reason to exist on the live production
 * database. Run against the docker-compose DB (54329, DATABASE_URL
 * default) or Supabase-local (54322, pass DATABASE_URL explicitly) — not
 * against the live pooler connection.
 *
 * Separate org/brand/outlet from the believable-chain fixture
 * (seed-believable-chain.ts) on purpose — that fixture is precision-tuned
 * for the RLS adversarial suite and the override precedence suite;
 * sharing its namespace risks perturbing suites that assert on its exact
 * shape. This is purely additive: run `pnpm seed` first, then this.
 *
 * Money math: a small LOCAL reimplementation (computeSimpleBill /
 * financialYearFor / formatInvoiceNumber below), matching
 * seed-believable-chain.ts's own established pattern for exactly this
 * reason (see that file's header comment) — NOT packages/domain directly.
 * Tried that first; @restrobooth/domain's package.json points main/types
 * at raw ./src/index.ts with extensionless relative imports, which only
 * resolves under the laxer moduleResolution apps/* happen to use. Under
 * packages/db's stricter nodenext config (the same one every other
 * workspace consumer of packages/db is held to) those imports don't
 * typecheck — a real, pre-existing gap in how domain exposes itself to a
 * strict-resolution consumer, not something to route around inside a
 * Slice 0 data-import task. Flagged in DECISIONS.md; the fix (give domain
 * a real build step, matching how packages/db itself is built) is its own
 * follow-up, not bundled in here.
 *
 * Known, deliberate simplifications (see file headers on the data files
 * for the full reasoning on each):
 * - No order_status_events rows — that log feeds live KDS reconnect
 *   replay, not needed for historical closed-out data.
 * - Alcohol taxed at the same GOODS_18 rate as every other beverage in
 *   this codebase's convention, not the real-world state VAT/excise
 *   regime (not modelled anywhere in this schema yet — a real, flagged
 *   gap, not a silent workaround).
 * - "Server" from the source data isn't modelled — RestroBooth's schema
 *   has no server/created-by column on orders (staff identity comes from
 *   the acting RLS session, not a stored column); dropped rather than
 *   forced into a field that doesn't fit.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDbClient, type Database } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import * as id from "./data/steakhouse-fixture-ids.js";
import { STEAKHOUSE_MENU, type StoreMenuItem } from "./data/steakhouse-menu.js";
import { generateSyntheticFeedback, type FeedbackSessionMeta } from "./data/steakhouse-feedback.js";

// ---------------------------------------------------------------------------
// Local, seed-only money/invoice math — mirrors seed-believable-chain.ts's
// own computeSimpleBill (see that file's header for why seed scripts don't
// call packages/domain directly, and this file's header for the
// module-resolution wrinkle that also applies here). CGST/SGST each
// rounded half-up independently, never derived by halving the combined
// rate's result (CLAUDE.md's money non-negotiable, honoured here at
// fixture scale the same as production scale).
// ---------------------------------------------------------------------------
interface SimpleBillLine {
  pricePaise: number;
  qty: number;
  taxRateBps: number;
}
function computeSimpleBill(lines: SimpleBillLine[]) {
  const subtotal = lines.reduce((sum, l) => sum + l.pricePaise * l.qty, 0);
  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.taxRateBps, (byRate.get(l.taxRateBps) ?? 0) + l.pricePaise * l.qty);
  const taxLines: { rateBps: number; taxable: number; cgst: number; sgst: number }[] = [];
  let tax = 0;
  for (const [rateBps, taxable] of byRate) {
    const halfRate = rateBps / 2 / 10000;
    const cgst = Math.round(taxable * halfRate);
    const sgst = Math.round(taxable * halfRate);
    tax += cgst + sgst;
    taxLines.push({ rateBps, taxable, cgst, sgst });
  }
  const gross = subtotal + tax;
  const roundedRupees = Math.round(gross / 100);
  const payable = roundedRupees * 100;
  const roundOff = payable - gross;
  return { subtotal, tax, roundOff, payable, taxLines };
}

/** DOMAIN.md §6.1: financial year is April–March. FY(2024-10-01) = "2425". */
function financialYearFor(businessDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) throw new Error(`financialYearFor: expected "YYYY-MM-DD", got "${businessDate}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const startYear = month >= 4 ? year : year - 1;
  return `${String(startYear).slice(2)}${String(startYear + 1).slice(2)}`;
}

function formatInvoiceNumber(seriesCode: string, financialYear: string, seq: bigint, seqWidth = 6): string {
  return `${seriesCode}/${financialYear}/${seq.toString().padStart(seqWidth, "0")}`;
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — same seed always produces the same
// dataset, so this generator is reproducible and diffable, not a fresh
// random dump on every run.
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let s = seed;
  return function random(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260723);

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}
function weightedPick(items: StoreMenuItem[]): StoreMenuItem {
  const total = items.reduce((sum, i) => sum + i.popularityWeight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.popularityWeight;
    if (r <= 0) return item;
  }
  return items[items.length - 1]!;
}
function weightedChoice<T extends string>(options: { value: T; weight: number }[]): T {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let r = rand() * total;
  for (const o of options) {
    r -= o.weight;
    if (r <= 0) return o.value;
  }
  return options[options.length - 1]!.value;
}

// ---------------------------------------------------------------------------
// Two months ending yesterday — "a few months" per the Phase 6 replan's
// own framing, and enough volume for co-occurrence/popularity/forecast-
// baseline testing without generating a full year at full-realistic
// volume (the source file's actual scale) into a dev database.
//
// Relative to today, NOT the source file's own 2024 date labels — those
// were just labels on a simulated dataset, and this project's partitioned
// tables only materialize partitions for a rolling window around the
// real "now" (create_partitions_ahead(12, 3), packages/db/drizzle/0003 +
// later re-declares). A fixed 2024 range predates every partition that
// currently exists (found by running this exact script — see
// DECISIONS.md) and would need manual partition surgery to fix, for a
// date range with no purpose over "the last couple of months," which
// this achieves for free and stays valid on every future re-run too.
// ---------------------------------------------------------------------------
const DAY_MS = 86_400_000;
// Phase 6 Slice 4: not every visit leaves feedback — ~9% gives a realistic
// (if generous) response rate, roughly 100-150 rows across ~60 days at
// this file's order volume.
const FEEDBACK_RATE = 0.09;
const TODAY = new Date();
const END_DATE = new Date(Date.UTC(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), TODAY.getUTCDate() - 1)); // yesterday
const START_DATE = new Date(END_DATE.getTime() - 60 * DAY_MS); // ~2 months back

function toBusinessDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fri/Sat busiest for a premium grill — matches the general shape a
 *  full-service steakhouse's real bookings follow. */
function ordersForDay(date: Date): number {
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const isWeekend = dow === 5 || dow === 6;
  const base = isWeekend ? 28 : 17;
  return base + Math.floor(rand() * (isWeekend ? 10 : 8));
}

/** Lunch (12:00-15:00) and dinner (18:00-22:30) service windows — no
 *  orders in the source data fell outside roughly these hours either. */
function randomTimeOfDay(): { hour: number; minute: number } {
  const isDinner = rand() < 0.65;
  const totalMin = isDinner ? 18 * 60 + Math.floor(rand() * (4.5 * 60)) : 12 * 60 + Math.floor(rand() * (3 * 60));
  return { hour: Math.floor(totalMin / 60), minute: totalMin % 60 };
}

const PAYMENT_METHOD_WEIGHTS = [
  { value: "card" as const, weight: 40 },
  { value: "upi_intent" as const, weight: 35 },
  { value: "cash" as const, weight: 25 },
];
const CHANNEL_WEIGHTS = [
  { value: "dinein" as const, weight: 70 },
  { value: "takeaway" as const, weight: 20 },
  { value: "delivery" as const, weight: 10 },
];

interface GeneratedOrder {
  businessDate: string;
  timestamp: Date;
  tableId: string;
  covers: number;
  channelCode: "dinein" | "takeaway" | "delivery";
  paymentMethod: "cash" | "card" | "upi_intent";
  items: { menuItem: StoreMenuItem; qty: number }[];
}

function generateBasket(): { menuItem: StoreMenuItem; qty: number }[] {
  const byCategory = (cat: StoreMenuItem["category"]) => STEAKHOUSE_MENU.filter((m) => m.category === cat);
  const entrees = byCategory("Entrees");
  const sides = byCategory("Sides");
  const apps = byCategory("Appetizers");
  const desserts = byCategory("Desserts");
  const beverages = byCategory("Beverages");

  const basket: { menuItem: StoreMenuItem; qty: number }[] = [];
  const numEntrees = 1 + (rand() < 0.4 ? 1 : 0); // most tables order 1 entree each; ~40% add a second (2-top+)
  for (let i = 0; i < numEntrees; i++) basket.push({ menuItem: weightedPick(entrees), qty: 1 });
  if (rand() < 0.6) basket.push({ menuItem: weightedPick(sides), qty: 1 + (rand() < 0.3 ? 1 : 0) });
  if (rand() < 0.45) basket.push({ menuItem: weightedPick(apps), qty: 1 });
  if (rand() < 0.3) basket.push({ menuItem: weightedPick(desserts), qty: 1 });
  if (rand() < 0.5) basket.push({ menuItem: weightedPick(beverages), qty: 1 + (rand() < 0.25 ? 1 : 0) });
  return basket;
}

async function bulkInsert<T extends Record<string, unknown>>(
  db: Database,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  rows: T[],
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await db.insert(table).values(rows.slice(i, i + chunkSize));
  }
}

export async function importSteakhouse(db: Database): Promise<void> {
  console.log("Tenancy: org, GSTIN, brand, outlet, store, terminal, area, tables...");
  await db.insert(schema.organizations).values([{ id: id.ORG, legalName: "Ember & Oak Hospitality Pvt Ltd" }]);
  await db.insert(schema.gstRegistrations).values([
    { id: id.GST_MH, orgId: id.ORG, gstin: "27AABCE9821F1Z3", stateCode: "27", legalName: "Ember & Oak Hospitality Pvt Ltd" },
  ]);
  await db.insert(schema.brands).values([{ id: id.BRAND, orgId: id.ORG, name: "Ember & Oak", slug: "ember-and-oak" }]);
  await db.insert(schema.outlets).values([
    {
      id: id.OUTLET,
      orgId: id.ORG,
      gstRegistrationId: id.GST_MH,
      name: "Mumbai — Bandra West",
      code: "BW1",
      address: { line1: "Linking Road", city: "Mumbai", state_code: "27" },
      kind: "restaurant",
    },
  ]);
  await db.insert(schema.stores).values([{ id: id.STORE, brandId: id.BRAND, outletId: id.OUTLET }]);
  await db.insert(schema.terminals).values([{ id: id.TERMINAL, outletId: id.OUTLET, code: "T1", name: "Front Counter" }]);
  await db.insert(schema.areas).values([{ id: id.AREA_MAIN, outletId: id.OUTLET, name: "Main Dining" }]);
  await db.insert(schema.tables).values(
    id.TABLE_IDS.map((tid, i) => ({
      id: tid,
      outletId: id.OUTLET,
      areaId: id.AREA_MAIN,
      label: `T${i + 1}`,
      capacity: i < 2 ? 2 : i < 6 ? 4 : 6,
    })),
  );

  console.log("Tax classes, categories, menu items...");
  await db.insert(schema.taxClasses).values([
    { id: id.TAX_FOOD5, orgId: id.ORG, code: "FOOD_5", rateBps: 500 },
    { id: id.TAX_GOODS18, orgId: id.ORG, code: "GOODS_18", rateBps: 1800 },
  ]);
  const categoryNames = [...new Set(STEAKHOUSE_MENU.map((m) => m.category))];
  const categoryIds = new Map<string, string>();
  await db.insert(schema.categories).values(
    categoryNames.map((name, i) => {
      const catId = crypto.randomUUID();
      categoryIds.set(name, catId);
      return { id: catId, brandId: id.BRAND, name, sortOrder: i };
    }),
  );

  const menuItemIds = new Map<string, string>();
  await db.insert(schema.menuItems).values(
    STEAKHOUSE_MENU.map((m) => {
      const mid = crypto.randomUUID();
      menuItemIds.set(m.name, mid);
      return {
        id: mid,
        brandId: id.BRAND,
        categoryId: categoryIds.get(m.category)!,
        name: m.name,
        basePricePaise: BigInt(m.pricePaise),
        taxClassId: m.taxClass === "FOOD_5" ? id.TAX_FOOD5 : id.TAX_GOODS18,
        diet: m.diet,
        allergens: m.allergens,
        status: "published" as const,
      };
    }),
  );

  console.log("Invoice series + block...");
  const financialYear = financialYearFor(toBusinessDate(START_DATE));
  await db.insert(schema.invoiceSeries).values([
    { id: id.INVOICE_SERIES, gstRegistrationId: id.GST_MH, outletId: id.OUTLET, seriesCode: "A1", financialYear, nextSeq: 1n },
  ]);
  await db.insert(schema.invoiceNumberBlocks).values([
    { id: id.INVOICE_BLOCK, invoiceSeriesId: id.INVOICE_SERIES, terminalId: id.TERMINAL, startSeq: 1n, endSeq: 50000n, nextSeq: 1n, status: "active" },
  ]);

  console.log("Generating orders...");
  const orders: GeneratedOrder[] = [];
  for (let d = new Date(START_DATE); d <= END_DATE; d = new Date(d.getTime() + DAY_MS)) {
    const count = ordersForDay(d);
    for (let i = 0; i < count; i++) {
      const { hour, minute } = randomTimeOfDay();
      const timestamp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, minute));
      orders.push({
        businessDate: toBusinessDate(d),
        timestamp,
        tableId: pick(id.TABLE_IDS),
        covers: 2 + Math.floor(rand() * 5),
        channelCode: weightedChoice(CHANNEL_WEIGHTS),
        paymentMethod: weightedChoice(PAYMENT_METHOD_WEIGHTS),
        items: generateBasket(),
      });
    }
  }
  // Chronological — invoice numbers must be gapless and reflect real
  // issuance order (CLAUDE.md: "a printed invoice number is immutable").
  orders.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const dayCount = Math.round((END_DATE.getTime() - START_DATE.getTime()) / DAY_MS) + 1;
  console.log(`  ${orders.length} orders across ${dayCount} days`);

  console.log("Business days...");
  const businessDayIds = new Map<string, string>();
  const businessDayRows: (typeof schema.businessDays.$inferInsert)[] = [];
  for (let d = new Date(START_DATE); d <= END_DATE; d = new Date(d.getTime() + DAY_MS)) {
    const bd = toBusinessDate(d);
    const bdId = crypto.randomUUID();
    businessDayIds.set(bd, bdId);
    businessDayRows.push({
      id: bdId,
      outletId: id.OUTLET,
      businessDate: bd,
      status: "closed",
      openedAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 11, 0)),
      closedAt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 30)),
    });
  }
  await bulkInsert(db, schema.businessDays, businessDayRows);

  console.log("Building order rows (in memory)...");
  const tableSessionRows: (typeof schema.tableSessions.$inferInsert)[] = [];
  const tableSessionTableRows: (typeof schema.tableSessionTables.$inferInsert)[] = [];
  const orderRows: (typeof schema.orders.$inferInsert)[] = [];
  const orderItemRows: (typeof schema.orderItems.$inferInsert)[] = [];
  const kotRows: (typeof schema.kots.$inferInsert)[] = [];
  const kotItemRows: (typeof schema.kotItems.$inferInsert)[] = [];
  const billRows: (typeof schema.bills.$inferInsert)[] = [];
  const billTaxLineRows: (typeof schema.billTaxLines.$inferInsert)[] = [];
  const paymentRows: (typeof schema.payments.$inferInsert)[] = [];

  const kotNumberByDay = new Map<string, number>();
  let invoiceSeq = 1n;
  // Phase 6 Slice 4: one entry per session, for the synthetic-feedback pass
  // below — needs the session's real ordered dish names (never an invented
  // one) and closedAt (feedback is submitted post-meal, not mid-service).
  const sessionMeta: FeedbackSessionMeta[] = [];

  for (const order of orders) {
    const businessDayId = businessDayIds.get(order.businessDate)!;
    const sessionId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const openedAt = order.timestamp;
    const closedAt = new Date(openedAt.getTime() + (45 + Math.floor(rand() * 45)) * 60000);
    sessionMeta.push({ sessionId, businessDate: order.businessDate, closedAt, dishNames: order.items.map((i) => i.menuItem.name) });

    tableSessionRows.push({
      id: sessionId,
      outletId: id.OUTLET,
      storeId: id.STORE,
      businessDayId,
      status: "closed",
      covers: order.covers,
      openedAt,
      closedAt,
      idempotencyKey: crypto.randomUUID(),
    });
    tableSessionTableRows.push({ tableSessionId: sessionId, tableId: order.tableId });

    orderRows.push({
      id: orderId,
      businessDate: order.businessDate,
      outletId: id.OUTLET,
      storeId: id.STORE,
      businessDayId,
      tableSessionId: sessionId,
      channelCode: order.channelCode,
      status: "settled",
      idempotencyKey: crypto.randomUUID(),
      createdAt: openedAt,
    });

    const lines = order.items.map(({ menuItem, qty }) => {
      const lineId = crypto.randomUUID();
      const taxClassId = menuItem.taxClass === "FOOD_5" ? id.TAX_FOOD5 : id.TAX_GOODS18;
      orderItemRows.push({
        id: lineId,
        businessDate: order.businessDate,
        orderId,
        outletId: id.OUTLET,
        storeId: id.STORE,
        menuItemId: menuItemIds.get(menuItem.name)!,
        quantity: qty,
        unitPricePaise: BigInt(menuItem.pricePaise),
        taxClassId,
        status: "served",
        clientLineId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        createdAt: openedAt,
      });
      return { lineId, qty, taxClassId, menuItem };
    });

    // Split into KOTs by kitchen section (hot/cold/bar) — matches how
    // apps/kds actually routes tickets, not one monolithic KOT per order.
    const bySection = new Map<string, typeof lines>();
    for (const l of lines) {
      const arr = bySection.get(l.menuItem.kitchenSection) ?? [];
      arr.push(l);
      bySection.set(l.menuItem.kitchenSection, arr);
    }
    let localKotNum = kotNumberByDay.get(order.businessDate) ?? 0;
    for (const [section, items] of bySection) {
      localKotNum += 1;
      const kotId = crypto.randomUUID();
      const firedAt = new Date(openedAt.getTime() + 3 * 60000);
      const bumpedAt = new Date(firedAt.getTime() + (10 + Math.floor(rand() * 15)) * 60000);
      kotRows.push({
        id: kotId,
        businessDate: order.businessDate,
        outletId: id.OUTLET,
        storeId: id.STORE,
        tableSessionId: sessionId,
        orderId,
        kitchenSection: section,
        kotNumber: localKotNum,
        status: "bumped",
        reprintCount: 0,
        firedAt,
        bumpedAt,
        idempotencyKey: crypto.randomUUID(),
      });
      for (const l of items) {
        kotItemRows.push({ id: crypto.randomUUID(), businessDate: order.businessDate, kotId, orderItemId: l.lineId, outletId: id.OUTLET, quantity: l.qty });
      }
    }
    kotNumberByDay.set(order.businessDate, localKotNum);

    const bill = computeSimpleBill(
      lines.map((l) => ({ pricePaise: l.menuItem.pricePaise, qty: l.qty, taxRateBps: l.taxClassId === id.TAX_FOOD5 ? 500 : 1800 })),
    );

    const billId = crypto.randomUUID();
    const invoiceNo = formatInvoiceNumber("A1", financialYear, invoiceSeq);
    invoiceSeq += 1n;
    billRows.push({
      id: billId,
      businessDate: order.businessDate,
      outletId: id.OUTLET,
      storeId: id.STORE,
      gstRegistrationId: id.GST_MH,
      terminalId: id.TERMINAL,
      tableSessionId: sessionId,
      invoiceNo,
      status: "settled",
      subtotalPaise: BigInt(bill.subtotal),
      discountPaise: 0n,
      chargesPaise: 0n,
      taxPaise: BigInt(bill.tax),
      roundOffPaise: BigInt(bill.roundOff),
      payablePaise: BigInt(bill.payable),
      idempotencyKey: crypto.randomUUID(),
      finalisedAt: closedAt,
    });
    for (const t of bill.taxLines) {
      const taxClassId = t.rateBps === 500 ? id.TAX_FOOD5 : id.TAX_GOODS18;
      billTaxLineRows.push(
        { billId, businessDate: order.businessDate, outletId: id.OUTLET, taxClassId, component: "cgst", taxablePaise: BigInt(t.taxable), rateBps: t.rateBps / 2, amountPaise: BigInt(t.cgst) },
        { billId, businessDate: order.businessDate, outletId: id.OUTLET, taxClassId, component: "sgst", taxablePaise: BigInt(t.taxable), rateBps: t.rateBps / 2, amountPaise: BigInt(t.sgst) },
      );
    }
    paymentRows.push({
      id: crypto.randomUUID(),
      businessDate: order.businessDate,
      billId,
      outletId: id.OUTLET,
      storeId: id.STORE,
      method: order.paymentMethod,
      amountPaise: BigInt(bill.payable),
      status: "captured",
      idempotencyKey: crypto.randomUUID(),
      createdAt: closedAt,
    });
  }

  await db.update(schema.invoiceSeries).set({ nextSeq: invoiceSeq }).where(eq(schema.invoiceSeries.id, id.INVOICE_SERIES));
  await db.update(schema.invoiceNumberBlocks).set({ nextSeq: invoiceSeq }).where(eq(schema.invoiceNumberBlocks.id, id.INVOICE_BLOCK));

  console.log(
    `Inserting ${tableSessionRows.length} table sessions, ${orderRows.length} orders, ${orderItemRows.length} order items, ${kotRows.length} kots, ${kotItemRows.length} kot items, ${billRows.length} bills, ${billTaxLineRows.length} tax lines, ${paymentRows.length} payments...`,
  );
  await bulkInsert(db, schema.tableSessions, tableSessionRows);
  await bulkInsert(db, schema.tableSessionTables, tableSessionTableRows);
  await bulkInsert(db, schema.orders, orderRows);
  await bulkInsert(db, schema.orderItems, orderItemRows);
  await bulkInsert(db, schema.kots, kotRows);
  await bulkInsert(db, schema.kotItems, kotItemRows);
  await bulkInsert(db, schema.bills, billRows);
  await bulkInsert(db, schema.billTaxLines, billTaxLineRows);
  await bulkInsert(db, schema.payments, paymentRows);

  console.log("Synthetic guest feedback (Phase 6 Slice 4 — generated fixture content, not real guest input)...");
  const feedbackRows = generateSyntheticFeedback(sessionMeta, rand, { outletId: id.OUTLET, storeId: id.STORE }, FEEDBACK_RATE);
  console.log(`  ${feedbackRows.length} feedback rows`);
  if (feedbackRows.length > 0) await db.insert(schema.feedback).values(feedbackRows);

  console.log("Done.");
}

// --- CLI entrypoint ---
async function cliMain() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(here, "../../../.env") });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
  await importSteakhouse(createDbClient(url));
}

// Windows-safe CLI-invocation check — see seed-believable-chain.ts's
// identical guard for why the naive file://${argv[1]} comparison silently
// no-ops on this platform.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cliMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
