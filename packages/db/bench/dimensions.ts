/**
 * The small, structural half of the BENCHMARKS.md fixture: orgs, brands,
 * outlets, stores, tax classes, menu items, dayparts, promos, users +
 * memberships. Low row count (thousands, not millions) — seeded via
 * Drizzle like the believable-chain seed, not set-based SQL. The set-based
 * SQL is reserved for the fact tables (orders/order_items/bills/etc, see
 * ./generators/), which is where the actual row-count problem is.
 *
 * Distribution, matching docs/BENCHMARKS.md's "20 outlets / 28 stores /
 * one outlet running 4 brands" exactly: 14 single-brand outlets + 5
 * dual-brand outlets + 1 quad-brand outlet (the cloud kitchen) = 20
 * outlets, 14 + 10 + 4 = 28 stores.
 *
 * ⚠️ Modelling call: the cloud-kitchen outlet hosts all 4 brands, including
 * the OTHER org's two brands — there is no DB constraint tying a store's
 * brand to its outlet's org (a white-label/franchise-kitchen arrangement
 * is legally possible), and BENCHMARKS.md's spec asks for exactly this
 * (2 orgs, 4 brands @ 2/org, one outlet running all 4) — it is the more
 * aggressive version of the A8 stress test, not an error.
 */
import { createDbClient, type Database } from "../src/client.js";
import * as schema from "../src/schema/index.js";

export const BENCH = {
  ORG_COUNT: 2,
  BRAND_COUNT: 4,
  OUTLET_COUNT: 20,
  ITEMS_PER_BRAND: 200,
  DAYPART_COUNT: 4,
  PROMO_COUNT: 10,
  USER_COUNT: 60,
  CLUSTER_MANAGER_COUNT: 4,
  OVERRIDE_RATE: 0.15,
  CHANNELS: ["dinein", "zomato", "swiggy", "ondc", "direct", "captain"] as const,
};

export type DimensionIds = {
  orgIds: string[];
  brandIds: string[]; // [org1brand1, org1brand2, org2brand1, org2brand2]
  outletIds: string[];
  storeIdsByOutlet: Map<string, string[]>; // outletId -> storeIds
  storeBrand: Map<string, string>; // storeId -> brandId
  taxFood5ByOrg: Map<string, string>;
  taxGoods18ByOrg: Map<string, string>;
  menuItemIdsByBrand: Map<string, string[]>;
  outletGroupIds: string[];
};

export async function seedDimensions(db: Database): Promise<DimensionIds> {
  console.log("[bench] Truncating (local dev only)...");
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
      stores, outlets, gst_registrations, brands, memberships, organizations,
      "auth"."users"
    cascade
  `);

  console.log("[bench] Orgs, GST registrations, brands...");
  const orgIds = [crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(schema.organizations).values(
    orgIds.map((id, i) => ({ id, legalName: `Bench Org ${i + 1}` })),
  );

  // 2 states per org, so IGST/dual-GSTIN stays live at bench scale too.
  const statesByOrg = [
    ["24", "27"], // org1: Gujarat, Maharashtra
    ["29", "33"], // org2: Karnataka, Tamil Nadu
  ];
  const gstByOrgState = new Map<string, string>(); // `${orgId}:${state}` -> gstId
  const gstRows = [];
  for (let o = 0; o < orgIds.length; o++) {
    for (const state of statesByOrg[o]!) {
      const gstId = crypto.randomUUID();
      gstByOrgState.set(`${orgIds[o]}:${state}`, gstId);
      gstRows.push({
        id: gstId, orgId: orgIds[o]!, gstin: `${state}AABCB${o}${state}9C1Z${state[1]}`,
        stateCode: state, legalName: `Bench Org ${o + 1}`,
      });
    }
  }
  await db.insert(schema.gstRegistrations).values(gstRows);

  const brandIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await db.insert(schema.brands).values([
    { id: brandIds[0]!, orgId: orgIds[0]!, name: "Bench Brand A1", slug: "bench-a1" },
    { id: brandIds[1]!, orgId: orgIds[0]!, name: "Bench Brand A2", slug: "bench-a2" },
    { id: brandIds[2]!, orgId: orgIds[1]!, name: "Bench Brand B1", slug: "bench-b1" },
    { id: brandIds[3]!, orgId: orgIds[1]!, name: "Bench Brand B2", slug: "bench-b2" },
  ]);

  console.log(`[bench] ${BENCH.OUTLET_COUNT} outlets, 28 stores...`);
  const outletIds: string[] = [];
  const storeIdsByOutlet = new Map<string, string[]>();
  const storeBrand = new Map<string, string>();
  const outletRows = [];
  const storeRows = [];

  for (let i = 0; i < BENCH.OUTLET_COUNT; i++) {
    const outletId = crypto.randomUUID();
    outletIds.push(outletId);
    const orgIdx = i % 2;
    const state = statesByOrg[orgIdx]![i % 2]!;
    const gstId = gstByOrgState.get(`${orgIds[orgIdx]}:${state}`)!;
    let kind: "restaurant" | "cloud_kitchen" = "restaurant";
    let brandsForOutlet: string[];

    if (i === BENCH.OUTLET_COUNT - 1) {
      // The one outlet running all 4 brands — the cloud kitchen.
      kind = "cloud_kitchen";
      brandsForOutlet = brandIds;
    } else if (i >= BENCH.OUTLET_COUNT - 6) {
      // 5 dual-brand outlets, same-org brand pairs.
      brandsForOutlet = orgIdx === 0 ? [brandIds[0]!, brandIds[1]!] : [brandIds[2]!, brandIds[3]!];
    } else {
      // 14 single-brand outlets, cycling through the 4 brands.
      brandsForOutlet = [brandIds[i % 4]!];
    }

    outletRows.push({
      id: outletId, orgId: orgIds[orgIdx]!, gstRegistrationId: gstId,
      name: `Bench Outlet ${i + 1}`, code: `B${String(i + 1).padStart(2, "0")}`,
      address: { state_code: state }, kind,
    });

    const storeIds: string[] = [];
    for (const brandId of brandsForOutlet) {
      const storeId = crypto.randomUUID();
      storeIds.push(storeId);
      storeBrand.set(storeId, brandId);
      storeRows.push({ id: storeId, brandId, outletId });
    }
    storeIdsByOutlet.set(outletId, storeIds);
  }
  await db.insert(schema.outlets).values(outletRows);
  await db.insert(schema.stores).values(storeRows);

  console.log("[bench] Outlet groups (4 cluster managers, overlapping)...");
  // Overlapping windows over the 20 outlets, per BENCHMARKS.md's "cluster
  // manager over a group of 5" query shape (Q3/BENCH-01).
  const outletGroupIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const groupWindows = [
    outletIds.slice(0, 6),
    outletIds.slice(4, 10),
    outletIds.slice(8, 14),
    outletIds.slice(12, 20),
  ];
  await db.insert(schema.outletGroups).values(
    outletGroupIds.map((id, i) => ({ id, orgId: orgIds[i % 2]!, name: `Bench Cluster ${i + 1}` })),
  );
  await db.insert(schema.outletGroupMembers).values(
    groupWindows.flatMap((outlets, i) => outlets.map((outletId) => ({ outletGroupId: outletGroupIds[i]!, outletId }))),
  );

  console.log("[bench] Tax classes, dayparts, promos...");
  const taxFood5ByOrg = new Map<string, string>();
  const taxGoods18ByOrg = new Map<string, string>();
  const taxRows = [];
  for (const orgId of orgIds) {
    const f5 = crypto.randomUUID();
    const g18 = crypto.randomUUID();
    taxFood5ByOrg.set(orgId, f5);
    taxGoods18ByOrg.set(orgId, g18);
    taxRows.push({ id: f5, orgId, code: "FOOD_5", rateBps: 500 }, { id: g18, orgId, code: "GOODS_18", rateBps: 1800 });
  }
  await db.insert(schema.taxClasses).values(taxRows);

  const daypartTemplates = [
    { code: "breakfast", name: "Breakfast", start: "07:00:00", end: "10:30:00" },
    { code: "lunch", name: "Lunch", start: "12:00:00", end: "15:30:00" },
    { code: "happy_hour", name: "Happy Hour", start: "17:00:00", end: "19:00:00" },
    { code: "dinner", name: "Dinner", start: "19:00:00", end: "23:00:00" },
  ];
  await db.insert(schema.dayparts).values(
    brandIds.map((brandId, i) => {
      const t = daypartTemplates[i % 4]!;
      return { id: crypto.randomUUID(), brandId, code: t.code, name: t.name, startTime: t.start, endTime: t.end };
    }),
  );

  // 10 active promos total, distributed across the 4 brands.
  const promoRows = [];
  for (let i = 0; i < BENCH.PROMO_COUNT; i++) {
    promoRows.push({
      id: crypto.randomUUID(), brandId: brandIds[i % 4]!, code: `BENCHPROMO${i + 1}`, name: `Bench Promo ${i + 1}`,
      startsAt: new Date(Date.now() - 86400000), status: "active" as const,
    });
  }
  await db.insert(schema.promos).values(promoRows);

  console.log(`[bench] ${BENCH.ITEMS_PER_BRAND * BENCH.BRAND_COUNT} menu items (200/brand)...`);
  const menuItemIdsByBrand = new Map<string, string[]>();
  const menuItemRows = [];
  for (const brandId of brandIds) {
    const orgId = brandIds.indexOf(brandId) < 2 ? orgIds[0]! : orgIds[1]!;
    const itemIds: string[] = [];
    for (let i = 0; i < BENCH.ITEMS_PER_BRAND; i++) {
      const itemId = crypto.randomUUID();
      itemIds.push(itemId);
      const isGoods = i % 5 === 0; // ~20% packaged goods, rest cooked food
      menuItemRows.push({
        id: itemId, brandId, name: `Bench Item ${i + 1}`,
        basePricePaise: BigInt(10000 + (i % 30) * 500),
        taxClassId: isGoods ? taxGoods18ByOrg.get(orgId)! : taxFood5ByOrg.get(orgId)!,
        diet: "veg" as const, status: "published" as const,
      });
    }
    menuItemIdsByBrand.set(brandId, itemIds);
  }
  await db.insert(schema.menuItems).values(menuItemRows);

  console.log("[bench] ~15% sparse override rows...");
  // One store-level price override per (item, store-of-that-brand) pair,
  // with ~15% probability — deliberately sparse (BENCHMARKS.md's own
  // warning: a dense set would unfairly favour materialisation).
  const overrideRows = [];
  for (const [storeId, brandId] of storeBrand) {
    const items = menuItemIdsByBrand.get(brandId)!;
    for (const itemId of items) {
      if (Math.random() < BENCH.OVERRIDE_RATE) {
        overrideRows.push({
          id: crypto.randomUUID(), menuItemId: itemId, storeId,
          pricePaise: BigInt(9000 + Math.floor(Math.random() * 3000)),
          effectiveFrom: new Date(Date.now() - 86400000),
          status: "published" as const, publishedAt: new Date(),
        });
      }
    }
  }
  // Insert in chunks — this can be several thousand rows.
  for (let i = 0; i < overrideRows.length; i += 1000) {
    await db.insert(schema.menuItemOverrides).values(overrideRows.slice(i, i + 1000));
  }
  console.log(`[bench]   ${overrideRows.length} override rows`);

  console.log(`[bench] ${BENCH.USER_COUNT} users + memberships (4 cluster managers, overlapping)...`);
  const userIds = Array.from({ length: BENCH.USER_COUNT }, () => crypto.randomUUID());
  await db.insert(schema.authUsers).values(userIds.map((id) => ({ id })));

  const membershipRows: (typeof schema.memberships.$inferInsert)[] = [];
  let u = 0;
  const nextUser = () => userIds[u++ % userIds.length]!;

  membershipRows.push(
    { id: crypto.randomUUID(), userId: nextUser(), scopeType: "org", scopeId: orgIds[0]!, role: "org_owner" },
    { id: crypto.randomUUID(), userId: nextUser(), scopeType: "org", scopeId: orgIds[1]!, role: "org_owner" },
  );
  for (const brandId of brandIds) {
    membershipRows.push({ id: crypto.randomUUID(), userId: nextUser(), scopeType: "brand", scopeId: brandId, role: "brand_manager" });
  }
  for (const groupId of outletGroupIds) {
    membershipRows.push({ id: crypto.randomUUID(), userId: nextUser(), scopeType: "outlet_group", scopeId: groupId, role: "cluster_manager" });
  }
  // Every outlet gets at least a manager + cashier; remaining users cycle
  // captain/kitchen across outlets until USER_COUNT is exhausted.
  for (const outletId of outletIds) {
    membershipRows.push(
      { id: crypto.randomUUID(), userId: nextUser(), scopeType: "outlet", scopeId: outletId, role: "outlet_manager" },
      { id: crypto.randomUUID(), userId: nextUser(), scopeType: "outlet", scopeId: outletId, role: "cashier" },
    );
  }
  const extraRoles = ["captain", "kitchen"] as const;
  let outletCursor = 0;
  while (u < BENCH.USER_COUNT) {
    const outletId = outletIds[outletCursor % outletIds.length]!;
    const role = extraRoles[outletCursor % extraRoles.length]!;
    membershipRows.push({ id: crypto.randomUUID(), userId: nextUser(), scopeType: "outlet", scopeId: outletId, role });
    outletCursor++;
  }
  await db.insert(schema.memberships).values(membershipRows);

  return { orgIds, brandIds, outletIds, storeIdsByOutlet, storeBrand, taxFood5ByOrg, taxGoods18ByOrg, menuItemIdsByBrand, outletGroupIds };
}

export function makeClient(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return createDbClient(url);
}
