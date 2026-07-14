/**
 * `pnpm seed` — the believable chain (docs/adr/0001-hosting.md, ROADMAP.md
 * Phase 1). 1 org (+1 separate org for cross-org RLS testing), 2 brands,
 * 3 outlets across 2 states (IGST/dual-GSTIN live from day one), one of
 * them a cloud kitchen where both brands share a physical outlet. A
 * ~120-item menu. This is also the fixture the RLS adversarial suite and
 * the override precedence suite are written against — every ID here is a
 * named constant in ./data/fixture-ids.ts for exactly that reason.
 *
 * seedBelievableChain(db) is exported so test/rls and test/override can
 * seed the SAME fixture against the Supabase-local Postgres (real
 * auth.uid()) rather than duplicating this logic. The CLI entrypoint at
 * the bottom is a thin wrapper around it for `pnpm seed`.
 *
 * Destructive: TRUNCATEs before seeding.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbClient, type Database } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import { menuItems as fullMenu, type SeedMenuItem } from "./data/menu-items.js";
import * as id from "./data/fixture-ids.js";

// ---------------------------------------------------------------------------
// A tiny, LOCAL, seed-only version of the bill math in DOMAIN.md §5 — not
// packages/domain (that's Phase 3b). Just enough to produce rows that pass
// the database's own check constraints (totals_reconcile, etc.) without
// hand-computing and risking a paisa-level mistake.
// ---------------------------------------------------------------------------
type BillLine = { pricePaise: number; qty: number; taxRateBps: number };
function computeSimpleBill(lines: BillLine[]) {
  const subtotal = lines.reduce((sum, l) => sum + l.pricePaise * l.qty, 0);
  const byRate = new Map<number, number>();
  for (const l of lines) {
    byRate.set(l.taxRateBps, (byRate.get(l.taxRateBps) ?? 0) + l.pricePaise * l.qty);
  }
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

export async function seedBelievableChain(db: Database) {
  console.log("Truncating (local dev only)...");
  await db.execute(`
    truncate table
      idempotency_keys, guest_sessions, qr_tokens,
      payments, bill_tax_lines, bills,
      invoice_number_gaps, invoice_number_blocks, invoice_series,
      order_status_events, kot_items, kots, order_item_voids, order_items,
      table_session_tables, table_sessions, orders,
      business_days, outlet_event_counters,
      menu_item_overrides, menu_items, promos, dayparts, tax_classes,
      terminals, tables, areas, outlet_group_members, outlet_groups,
      stores, outlets, gst_registrations, brands, memberships, organizations, "auth"."users"
    cascade
  `);

  console.log("Tenancy: orgs, GSTINs, brands, outlets, stores...");
  await db.insert(schema.organizations).values([
    { id: id.ORG1, legalName: "Spice Route Hospitality Pvt Ltd" },
    { id: id.ORG2, legalName: "Urban Bites Franchise LLP" },
  ]);

  await db.insert(schema.gstRegistrations).values([
    { id: id.GST_GJ, orgId: id.ORG1, gstin: "24AABCS1429B1Z1", stateCode: "24", legalName: "Spice Route Hospitality Pvt Ltd" },
    { id: id.GST_MH, orgId: id.ORG1, gstin: "27AABCS1429B1Z8", stateCode: "27", legalName: "Spice Route Hospitality Pvt Ltd" },
    { id: id.GST_KA, orgId: id.ORG2, gstin: "29AABCU4567C1Z5", stateCode: "29", legalName: "Urban Bites Franchise LLP" },
  ]);

  await db.insert(schema.brands).values([
    { id: id.BRAND_A, orgId: id.ORG1, name: "Spice Route", slug: "spice-route" },
    { id: id.BRAND_B, orgId: id.ORG1, name: "Wok Express", slug: "wok-express" },
    { id: id.BRAND_C, orgId: id.ORG2, name: "Urban Bites", slug: "urban-bites" },
  ]);

  await db.insert(schema.outlets).values([
    { id: id.OUTLET_AMD, orgId: id.ORG1, gstRegistrationId: id.GST_GJ, name: "Ahmedabad — Vastrapur", code: "AMD", address: { line1: "SG Highway", city: "Ahmedabad", state_code: "24" }, kind: "restaurant" },
    { id: id.OUTLET_SURAT, orgId: id.ORG1, gstRegistrationId: id.GST_GJ, name: "Surat Cloud Kitchen", code: "SUR", address: { line1: "Ring Road", city: "Surat", state_code: "24" }, kind: "cloud_kitchen" },
    { id: id.OUTLET_MUM, orgId: id.ORG1, gstRegistrationId: id.GST_MH, name: "Mumbai — Andheri", code: "MUM", address: { line1: "Andheri West", city: "Mumbai", state_code: "27" }, kind: "restaurant" },
    { id: id.OUTLET_BLR, orgId: id.ORG2, gstRegistrationId: id.GST_KA, name: "Bangalore — Indiranagar", code: "BLR", address: { line1: "100 Ft Road", city: "Bangalore", state_code: "29" }, kind: "restaurant" },
  ]);

  // The cloud-kitchen case: BOTH brands sell out of one physical outlet.
  await db.insert(schema.stores).values([
    { id: id.STORE_AMD_A, brandId: id.BRAND_A, outletId: id.OUTLET_AMD },
    { id: id.STORE_SURAT_A, brandId: id.BRAND_A, outletId: id.OUTLET_SURAT },
    { id: id.STORE_SURAT_B, brandId: id.BRAND_B, outletId: id.OUTLET_SURAT },
    { id: id.STORE_MUM_B, brandId: id.BRAND_B, outletId: id.OUTLET_MUM },
    { id: id.STORE_BLR_C, brandId: id.BRAND_C, outletId: id.OUTLET_BLR },
  ]);

  await db.insert(schema.outletGroups).values([{ id: id.OUTLET_GROUP_WEST, orgId: id.ORG1, name: "West (Gujarat)" }]);
  await db.insert(schema.outletGroupMembers).values([
    { outletGroupId: id.OUTLET_GROUP_WEST, outletId: id.OUTLET_AMD },
    { outletGroupId: id.OUTLET_GROUP_WEST, outletId: id.OUTLET_SURAT },
  ]);

  console.log("Areas, tables, terminals...");
  await db.insert(schema.areas).values([
    { id: id.AREA_AMD_MAIN, outletId: id.OUTLET_AMD, name: "Main Dining" },
    { id: id.AREA_SURAT_MAIN, outletId: id.OUTLET_SURAT, name: "Kitchen (no dine-in)" },
    { id: id.AREA_MUM_MAIN, outletId: id.OUTLET_MUM, name: "Main Dining" },
    { id: id.AREA_BLR_MAIN, outletId: id.OUTLET_BLR, name: "Main Dining" },
  ]);

  // Surat is a cloud kitchen: no dine-in tables, delivery/takeout only.
  // AMD's first two tables are NAMED constants (TABLE_AMD_1/2 = "T5"/"T6"
  // in TENANCY.md §6's generic naming) — the anonymous-guest adversarial
  // cases (A11-A14) need two distinct, addressable tables at the same
  // outlet to prove table-level isolation, not just outlet-level.
  const tableRows = [
    { id: id.TABLE_AMD_1, outletId: id.OUTLET_AMD, areaId: id.AREA_AMD_MAIN, label: "T1", capacity: 4 },
    { id: id.TABLE_AMD_2, outletId: id.OUTLET_AMD, areaId: id.AREA_AMD_MAIN, label: "T2", capacity: 4 },
  ];
  for (let i = 3; i <= 8; i++) tableRows.push({ id: crypto.randomUUID(), outletId: id.OUTLET_AMD, areaId: id.AREA_AMD_MAIN, label: `T${i}`, capacity: i % 4 === 0 ? 6 : 4 });
  for (let i = 1; i <= 6; i++) tableRows.push({ id: crypto.randomUUID(), outletId: id.OUTLET_MUM, areaId: id.AREA_MUM_MAIN, label: `T${i}`, capacity: 4 });
  for (let i = 1; i <= 5; i++) tableRows.push({ id: crypto.randomUUID(), outletId: id.OUTLET_BLR, areaId: id.AREA_BLR_MAIN, label: `T${i}`, capacity: 4 });
  const amdTableOne = id.TABLE_AMD_1;
  await db.insert(schema.tables).values(tableRows);

  await db.insert(schema.terminals).values([
    { id: id.TERMINAL_AMD_T1, outletId: id.OUTLET_AMD, code: "T1", name: "Front Counter" },
    { id: id.TERMINAL_SURAT_T1, outletId: id.OUTLET_SURAT, code: "T1", name: "Packing Counter" },
    { id: id.TERMINAL_MUM_T1, outletId: id.OUTLET_MUM, code: "T1", name: "Front Counter" },
    { id: id.TERMINAL_BLR_T1, outletId: id.OUTLET_BLR, code: "T1", name: "Front Counter" },
  ]);

  console.log("Users + memberships...");
  await db.insert(schema.authUsers).values(
    [
      id.USER_ORG1_OWNER, id.USER_BRANDA_MGR, id.USER_BRANDB_MGR, id.USER_WEST_CLUSTER,
      id.USER_AMD_MGR, id.USER_AMD_CASHIER, id.USER_AMD_CAPTAIN, id.USER_AMD_KITCHEN,
      id.USER_SURAT_MGR, id.USER_SURAT_CASHIER, id.USER_SURAT_CAPTAIN, id.USER_SURAT_KITCHEN,
      id.USER_MUM_MGR, id.USER_MUM_CASHIER, id.USER_MUM_CAPTAIN, id.USER_MUM_KITCHEN,
      id.USER_ORG2_OWNER,
    ].map((uid) => ({ id: uid })),
  );

  await db.insert(schema.memberships).values([
    { id: crypto.randomUUID(), userId: id.USER_ORG1_OWNER, scopeType: "org", scopeId: id.ORG1, role: "org_owner" },
    { id: crypto.randomUUID(), userId: id.USER_BRANDA_MGR, scopeType: "brand", scopeId: id.BRAND_A, role: "brand_manager" },
    { id: crypto.randomUUID(), userId: id.USER_BRANDB_MGR, scopeType: "brand", scopeId: id.BRAND_B, role: "brand_manager" },
    { id: crypto.randomUUID(), userId: id.USER_WEST_CLUSTER, scopeType: "outlet_group", scopeId: id.OUTLET_GROUP_WEST, role: "cluster_manager" },

    { id: crypto.randomUUID(), userId: id.USER_AMD_MGR, scopeType: "outlet", scopeId: id.OUTLET_AMD, role: "outlet_manager" },
    { id: crypto.randomUUID(), userId: id.USER_AMD_CASHIER, scopeType: "outlet", scopeId: id.OUTLET_AMD, role: "cashier" },
    { id: crypto.randomUUID(), userId: id.USER_AMD_CAPTAIN, scopeType: "outlet", scopeId: id.OUTLET_AMD, role: "captain" },
    { id: crypto.randomUUID(), userId: id.USER_AMD_KITCHEN, scopeType: "outlet", scopeId: id.OUTLET_AMD, role: "kitchen" },

    { id: crypto.randomUUID(), userId: id.USER_SURAT_MGR, scopeType: "outlet", scopeId: id.OUTLET_SURAT, role: "outlet_manager" },
    { id: crypto.randomUUID(), userId: id.USER_SURAT_CASHIER, scopeType: "outlet", scopeId: id.OUTLET_SURAT, role: "cashier" },
    { id: crypto.randomUUID(), userId: id.USER_SURAT_CAPTAIN, scopeType: "outlet", scopeId: id.OUTLET_SURAT, role: "captain" },
    { id: crypto.randomUUID(), userId: id.USER_SURAT_KITCHEN, scopeType: "outlet", scopeId: id.OUTLET_SURAT, role: "kitchen" },

    { id: crypto.randomUUID(), userId: id.USER_MUM_MGR, scopeType: "outlet", scopeId: id.OUTLET_MUM, role: "outlet_manager" },
    { id: crypto.randomUUID(), userId: id.USER_MUM_CASHIER, scopeType: "outlet", scopeId: id.OUTLET_MUM, role: "cashier" },
    { id: crypto.randomUUID(), userId: id.USER_MUM_CAPTAIN, scopeType: "outlet", scopeId: id.OUTLET_MUM, role: "captain" },
    { id: crypto.randomUUID(), userId: id.USER_MUM_KITCHEN, scopeType: "outlet", scopeId: id.OUTLET_MUM, role: "kitchen" },

    { id: crypto.randomUUID(), userId: id.USER_ORG2_OWNER, scopeType: "org", scopeId: id.ORG2, role: "org_owner" },
  ]);

  console.log("Tax classes + menu (~120 items)...");
  await db.insert(schema.taxClasses).values([
    { id: id.TAX_FOOD5_ORG1, orgId: id.ORG1, code: "FOOD_5", rateBps: 500 },
    { id: id.TAX_GOODS18_ORG1, orgId: id.ORG1, code: "GOODS_18", rateBps: 1800 },
    { id: id.TAX_FOOD5_ORG2, orgId: id.ORG2, code: "FOOD_5", rateBps: 500 },
    { id: id.TAX_GOODS18_ORG2, orgId: id.ORG2, code: "GOODS_18", rateBps: 1800 },
  ]);

  const taxClassIdOrg1 = (item: SeedMenuItem) => (item.taxClass === "FOOD_5" ? id.TAX_FOOD5_ORG1 : id.TAX_GOODS18_ORG1);
  const taxClassIdOrg2 = (item: SeedMenuItem) => (item.taxClass === "FOOD_5" ? id.TAX_FOOD5_ORG2 : id.TAX_GOODS18_ORG2);

  // Brand A (Spice Route): the full 119-item multi-cuisine menu.
  const brandAItemIds = new Map<string, string>();
  const brandAMenuRows = fullMenu.map((item) => {
    const itemId = crypto.randomUUID();
    brandAItemIds.set(item.name, itemId);
    return {
      id: itemId, brandId: id.BRAND_A, name: item.name, basePricePaise: BigInt(item.pricePaise),
      taxClassId: taxClassIdOrg1(item), diet: item.diet, allergens: item.allergens, status: "published" as const,
    };
  });

  // Brand B (Wok Express): the indo-chinese/wok subset — a distinctly
  // smaller, differently-themed menu at the SAME shared kitchen.
  const wokKeywords = ["Noodles", "Fried Rice", "Soup", "Manchurian", "Chilli", "Schezwan", "Hakka", "65"];
  const brandBSource = fullMenu.filter((i) => wokKeywords.some((kw) => i.name.includes(kw)));
  const brandBItemIds = new Map<string, string>();
  const brandBMenuRows = brandBSource.map((item) => {
    const itemId = crypto.randomUUID();
    brandBItemIds.set(item.name, itemId);
    return {
      id: itemId, brandId: id.BRAND_B, name: item.name, basePricePaise: BigInt(item.pricePaise),
      taxClassId: taxClassIdOrg1(item), diet: item.diet, allergens: item.allergens, status: "published" as const,
    };
  });

  // Brand C (Urban Bites, org2): a small, deliberately hand-picked list —
  // includes items the seed's bill for BLR references by name.
  const brandCNames = [
    "Paneer Butter Masala", "Dal Tadka", "Veg Thali", "Non-Veg Thali", "Butter Chicken",
    "Chicken Curry", "Masala Dosa", "Veg Fried Rice", "Gulab Jamun (2 pcs)", "Masala Chai",
    "Sweet Lassi", "Packaged Mineral Water 1L", "Tandoori Roti", "Butter Naan", "Green Salad",
  ];
  const brandCSource = fullMenu.filter((i) => brandCNames.includes(i.name));
  const brandCItemIds = new Map<string, string>();
  const brandCMenuRows = brandCSource.map((item) => {
    const itemId = crypto.randomUUID();
    brandCItemIds.set(item.name, itemId);
    return {
      id: itemId, brandId: id.BRAND_C, name: item.name, basePricePaise: BigInt(item.pricePaise),
      taxClassId: taxClassIdOrg2(item), diet: item.diet, allergens: item.allergens, status: "published" as const,
    };
  });

  await db.insert(schema.menuItems).values([...brandAMenuRows, ...brandBMenuRows, ...brandCMenuRows]);
  console.log(`  Brand A (Spice Route): ${brandAMenuRows.length} items`);
  console.log(`  Brand B (Wok Express): ${brandBMenuRows.length} items`);
  console.log(`  Brand C (Urban Bites): ${brandCMenuRows.length} items`);

  // A single, real override: Ahmedabad charges more for its best-seller than
  // the brand default — the exact scenario TENANCY.md §7.4 opens with.
  const butterChickenId = brandAItemIds.get("Butter Chicken")!;
  await db.insert(schema.menuItemOverrides).values([
    {
      id: crypto.randomUUID(), menuItemId: butterChickenId, storeId: id.STORE_AMD_A,
      pricePaise: 40000n, effectiveFrom: new Date(Date.now() - 86400000), status: "published", publishedAt: new Date(),
    },
  ]);

  console.log("Business days (open)...");
  await db.insert(schema.businessDays).values([
    { id: id.BIZDAY_AMD, outletId: id.OUTLET_AMD, businessDate: today(), status: "open", openedBy: id.USER_AMD_MGR, openedAt: new Date() },
    { id: id.BIZDAY_SURAT, outletId: id.OUTLET_SURAT, businessDate: today(), status: "open", openedBy: id.USER_SURAT_MGR, openedAt: new Date() },
    { id: id.BIZDAY_MUM, outletId: id.OUTLET_MUM, businessDate: today(), status: "open", openedBy: id.USER_MUM_MGR, openedAt: new Date() },
    { id: id.BIZDAY_BLR, outletId: id.OUTLET_BLR, businessDate: today(), status: "open", openedAt: new Date() },
  ]);
  await db.insert(schema.outletEventCounters).values([
    { outletId: id.OUTLET_AMD }, { outletId: id.OUTLET_SURAT }, { outletId: id.OUTLET_MUM }, { outletId: id.OUTLET_BLR },
  ]);

  console.log("Invoice series (one per outlet)...");
  const seriesRows = [
    { seriesId: id.INVOICE_SERIES_AMD, gst: id.GST_GJ, outlet: id.OUTLET_AMD, terminal: id.TERMINAL_AMD_T1 },
    { seriesId: id.INVOICE_SERIES_SURAT, gst: id.GST_GJ, outlet: id.OUTLET_SURAT, terminal: id.TERMINAL_SURAT_T1 },
    { seriesId: id.INVOICE_SERIES_MUM, gst: id.GST_MH, outlet: id.OUTLET_MUM, terminal: id.TERMINAL_MUM_T1 },
    { seriesId: id.INVOICE_SERIES_BLR, gst: id.GST_KA, outlet: id.OUTLET_BLR, terminal: id.TERMINAL_BLR_T1 },
  ];
  await db.insert(schema.invoiceSeries).values(
    seriesRows.map((s) => ({ id: s.seriesId, gstRegistrationId: s.gst, outletId: s.outlet, seriesCode: "A1", financialYear: financialYear(), nextSeq: 2n })),
  );
  await db.insert(schema.invoiceNumberBlocks).values(
    seriesRows.map((s) => ({ id: crypto.randomUUID(), invoiceSeriesId: s.seriesId, terminalId: s.terminal, startSeq: 1n, endSeq: 300n, nextSeq: 2n, status: "active" as const })),
  );

  console.log("A light end-to-end narrative at each outlet (table session -> order -> KOT -> bill -> payment)...");

  // Ahmedabad: Brand A menu, at the OVERRIDE price (₹400, not the ₹380 default).
  await seedNarrative(db, {
    tableSessionId: id.TABLE_SESSION_AMD_1, orderId: id.ORDER_AMD_1, kotId: id.KOT_AMD_1, billId: id.BILL_AMD_1,
    outletId: id.OUTLET_AMD, storeId: id.STORE_AMD_A, businessDayId: id.BIZDAY_AMD, gstRegistrationId: id.GST_GJ,
    terminalId: id.TERMINAL_AMD_T1, tableId: amdTableOne, seriesId: id.INVOICE_SERIES_AMD, invoiceSeq: 1,
    lines: [
      { menuItemId: butterChickenId, name: "Butter Chicken", unitPricePaise: 40000, qty: 1, taxClassId: id.TAX_FOOD5_ORG1, taxRateBps: 500 },
      { menuItemId: brandAItemIds.get("Butter Naan")!, name: "Butter Naan", unitPricePaise: 4500, qty: 2, taxClassId: id.TAX_GOODS18_ORG1, taxRateBps: 1800 },
    ],
  });

  // A second, minimal session+order at TABLE_AMD_2 ("T6") — no KOT/bill,
  // just enough for A11 to have a real orders row to attempt reading and
  // be denied. Table-level isolation: a guest at T5 must not read this.
  await db.insert(schema.tableSessions).values([{
    id: id.TABLE_SESSION_AMD_2, outletId: id.OUTLET_AMD, storeId: id.STORE_AMD_A, businessDayId: id.BIZDAY_AMD,
    status: "dining", covers: 2, openedAt: new Date(Date.now() - 1800000), idempotencyKey: crypto.randomUUID(),
  }]);
  await db.insert(schema.tableSessionTables).values([{ tableSessionId: id.TABLE_SESSION_AMD_2, tableId: id.TABLE_AMD_2 }]);
  await db.insert(schema.orders).values([{
    id: id.ORDER_AMD_2, businessDate: today(), outletId: id.OUTLET_AMD, storeId: id.STORE_AMD_A,
    businessDayId: id.BIZDAY_AMD, tableSessionId: id.TABLE_SESSION_AMD_2, channelCode: "dinein",
    status: "open", idempotencyKey: crypto.randomUUID(),
  }]);

  // QR token + guest session for TABLE_AMD_1 ("T5"), bound to the FIRST
  // (full) table session — the anonymous-guest adversarial cases need a
  // real qr_tokens/guest_sessions row to authenticate as, matching
  // "the QR token IS the auth" (TENANCY.md §6).
  await db.insert(schema.qrTokens).values([{
    id: id.QR_TOKEN_AMD_T1, outletId: id.OUTLET_AMD, tableId: id.TABLE_AMD_1,
    tokenHash: "test-fixture-token-hash-amd-t1", rotatesAt: new Date(Date.now() + 3600000),
  }]);
  await db.insert(schema.guestSessions).values([{
    id: id.GUEST_SESSION_AMD_T1, tableSessionId: id.TABLE_SESSION_AMD_1, storeId: id.STORE_AMD_A,
    qrTokenId: id.QR_TOKEN_AMD_T1, expiresAt: new Date(Date.now() + 3600000),
  }]);

  // Surat, Brand A store: same combo, brand default price (no override here).
  await seedNarrative(db, {
    tableSessionId: crypto.randomUUID(), orderId: crypto.randomUUID(), kotId: crypto.randomUUID(), billId: crypto.randomUUID(),
    outletId: id.OUTLET_SURAT, storeId: id.STORE_SURAT_A, businessDayId: id.BIZDAY_SURAT, gstRegistrationId: id.GST_GJ,
    terminalId: id.TERMINAL_SURAT_T1, tableId: null, seriesId: id.INVOICE_SERIES_SURAT, invoiceSeq: 1,
    lines: [
      { menuItemId: brandAItemIds.get("Butter Chicken")!, name: "Butter Chicken", unitPricePaise: 38000, qty: 1, taxClassId: id.TAX_FOOD5_ORG1, taxRateBps: 500 },
      { menuItemId: brandAItemIds.get("Butter Naan")!, name: "Butter Naan", unitPricePaise: 4500, qty: 2, taxClassId: id.TAX_GOODS18_ORG1, taxRateBps: 1800 },
    ],
  });

  // Surat, Brand B store: THE A8 CASE — same outlet, sibling brand, its own order.
  await seedNarrative(db, {
    tableSessionId: crypto.randomUUID(), orderId: crypto.randomUUID(), kotId: crypto.randomUUID(), billId: crypto.randomUUID(),
    outletId: id.OUTLET_SURAT, storeId: id.STORE_SURAT_B, businessDayId: id.BIZDAY_SURAT, gstRegistrationId: id.GST_GJ,
    terminalId: id.TERMINAL_SURAT_T1, tableId: null, seriesId: id.INVOICE_SERIES_SURAT, invoiceSeq: 2,
    lines: [
      { menuItemId: brandBItemIds.get("Chicken Hakka Noodles")!, name: "Chicken Hakka Noodles", unitPricePaise: 25000, qty: 1, taxClassId: id.TAX_FOOD5_ORG1, taxRateBps: 500 },
      { menuItemId: brandBItemIds.get("Sweet Corn Soup (Veg)")!, name: "Sweet Corn Soup (Veg)", unitPricePaise: 13000, qty: 1, taxClassId: id.TAX_FOOD5_ORG1, taxRateBps: 500 },
    ],
  });

  // Mumbai: Brand B only.
  await seedNarrative(db, {
    tableSessionId: crypto.randomUUID(), orderId: crypto.randomUUID(), kotId: crypto.randomUUID(), billId: crypto.randomUUID(),
    outletId: id.OUTLET_MUM, storeId: id.STORE_MUM_B, businessDayId: id.BIZDAY_MUM, gstRegistrationId: id.GST_MH,
    terminalId: id.TERMINAL_MUM_T1, tableId: null, seriesId: id.INVOICE_SERIES_MUM, invoiceSeq: 1,
    lines: [
      { menuItemId: brandBItemIds.get("Chicken Hakka Noodles")!, name: "Chicken Hakka Noodles", unitPricePaise: 25000, qty: 1, taxClassId: id.TAX_FOOD5_ORG1, taxRateBps: 500 },
      { menuItemId: brandBItemIds.get("Sweet Corn Soup (Veg)")!, name: "Sweet Corn Soup (Veg)", unitPricePaise: 13000, qty: 1, taxClassId: id.TAX_FOOD5_ORG1, taxRateBps: 500 },
    ],
  });

  // Bangalore (org2 — a separate franchisee, case A10).
  await seedNarrative(db, {
    tableSessionId: crypto.randomUUID(), orderId: crypto.randomUUID(), kotId: crypto.randomUUID(), billId: crypto.randomUUID(),
    outletId: id.OUTLET_BLR, storeId: id.STORE_BLR_C, businessDayId: id.BIZDAY_BLR, gstRegistrationId: id.GST_KA,
    terminalId: id.TERMINAL_BLR_T1, tableId: null, seriesId: id.INVOICE_SERIES_BLR, invoiceSeq: 1,
    lines: [
      { menuItemId: brandCItemIds.get("Veg Thali")!, name: "Veg Thali", unitPricePaise: 26000, qty: 1, taxClassId: id.TAX_FOOD5_ORG2, taxRateBps: 500 },
      { menuItemId: brandCItemIds.get("Packaged Mineral Water 1L")!, name: "Packaged Mineral Water 1L", unitPricePaise: 4000, qty: 1, taxClassId: id.TAX_GOODS18_ORG2, taxRateBps: 1800 },
    ],
  });

  console.log("\nDone. Seed summary:");
  console.log(`  2 orgs, 3 GST registrations, 3 brands, 4 outlets, 5 stores`);
  console.log(`  ${brandAMenuRows.length + brandBMenuRows.length + brandCMenuRows.length} menu items total`);
  console.log(`  17 users across all 7 roles, incl. the cloud-kitchen brand-manager (A8) case`);
  console.log(`  5 end-to-end order->KOT->bill->payment narratives, one per store`);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function financialYear(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 3 ? y : y - 1; // FY starts April (month index 3)
  return `${String(startYear).slice(2)}${String(startYear + 1).slice(2)}`;
}

type NarrativeLine = { menuItemId: string; name: string; unitPricePaise: number; qty: number; taxClassId: string; taxRateBps: number };
async function seedNarrative(db: Database, args: {
  tableSessionId: string; orderId: string; kotId: string; billId: string;
  outletId: string; storeId: string; businessDayId: string; gstRegistrationId: string;
  terminalId: string; tableId: string | null; seriesId: string; invoiceSeq: number;
  lines: NarrativeLine[];
}) {
  const bill = computeSimpleBill(args.lines.map((l) => ({ pricePaise: l.unitPricePaise, qty: l.qty, taxRateBps: l.taxRateBps })));

  await db.insert(schema.tableSessions).values([{
    id: args.tableSessionId, outletId: args.outletId, storeId: args.storeId, businessDayId: args.businessDayId,
    status: "closed", covers: 2, openedAt: new Date(Date.now() - 3600000), closedAt: new Date(),
    idempotencyKey: crypto.randomUUID(),
  }]);
  if (args.tableId) {
    await db.insert(schema.tableSessionTables).values([{ tableSessionId: args.tableSessionId, tableId: args.tableId }]);
  }

  await db.insert(schema.orders).values([{
    id: args.orderId, businessDate: today(), outletId: args.outletId, storeId: args.storeId,
    businessDayId: args.businessDayId, tableSessionId: args.tableSessionId, channelCode: "dinein",
    status: "settled", idempotencyKey: crypto.randomUUID(),
  }]);

  const orderItemRows = args.lines.map((l) => ({
    id: crypto.randomUUID(), businessDate: today(), orderId: args.orderId, outletId: args.outletId, storeId: args.storeId,
    menuItemId: l.menuItemId, quantity: l.qty, unitPricePaise: BigInt(l.unitPricePaise), taxClassId: l.taxClassId,
    status: "served" as const, clientLineId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(),
  }));
  await db.insert(schema.orderItems).values(orderItemRows);

  await db.insert(schema.kots).values([{
    id: args.kotId, businessDate: today(), outletId: args.outletId, storeId: args.storeId,
    tableSessionId: args.tableSessionId, orderId: args.orderId, kitchenSection: "hot", kotNumber: args.invoiceSeq,
    status: "bumped", firedAt: new Date(Date.now() - 3000000), bumpedAt: new Date(Date.now() - 2400000),
    idempotencyKey: crypto.randomUUID(),
  }]);
  await db.insert(schema.kotItems).values(
    orderItemRows.map((oi) => ({
      id: crypto.randomUUID(), businessDate: today(), kotId: args.kotId, orderItemId: oi.id, outletId: args.outletId, quantity: oi.quantity,
    })),
  );

  const invoiceNo = `A1/${financialYear()}/${String(args.invoiceSeq).padStart(6, "0")}`;
  await db.insert(schema.bills).values([{
    id: args.billId, businessDate: today(), outletId: args.outletId, storeId: args.storeId,
    gstRegistrationId: args.gstRegistrationId, terminalId: args.terminalId, invoiceNo, status: "settled",
    subtotalPaise: BigInt(bill.subtotal), discountPaise: 0n, chargesPaise: 0n, taxPaise: BigInt(bill.tax),
    roundOffPaise: BigInt(bill.roundOff), payablePaise: BigInt(bill.payable),
    idempotencyKey: crypto.randomUUID(), finalisedAt: new Date(),
  }]);

  const taxLineRows = bill.taxLines.flatMap((t) => {
    const taxClassId = args.lines.find((l) => l.taxRateBps === t.rateBps)!.taxClassId;
    return [
      { billId: args.billId, businessDate: today(), outletId: args.outletId, taxClassId, component: "cgst" as const, taxablePaise: BigInt(t.taxable), rateBps: t.rateBps / 2, amountPaise: BigInt(t.cgst) },
      { billId: args.billId, businessDate: today(), outletId: args.outletId, taxClassId, component: "sgst" as const, taxablePaise: BigInt(t.taxable), rateBps: t.rateBps / 2, amountPaise: BigInt(t.sgst) },
    ];
  });
  await db.insert(schema.billTaxLines).values(taxLineRows);

  await db.insert(schema.payments).values([{
    id: crypto.randomUUID(), businessDate: today(), billId: args.billId, outletId: args.outletId, storeId: args.storeId,
    method: "cash", amountPaise: BigInt(bill.payable), status: "captured", idempotencyKey: crypto.randomUUID(),
  }]);
}

// --- CLI entrypoint (`pnpm seed`) — everything above is importable directly. ---
async function cliMain() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(here, "../../../.env") });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
  await seedBelievableChain(createDbClient(url));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  cliMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
