/**
 * Override precedence suite infrastructure (docs/TENANCY.md §7.4). The
 * 21-row table is NOT a monotonic build-up — several rows (9, 13, 14, 15)
 * drop earlier rows rather than only adding to them — so each test case
 * sets up its OWN exact override set from scratch rather than
 * incrementally mutating shared state. A dedicated test-only menu item
 * (not the real seeded "Butter Chicken") so this suite's churn can never
 * interfere with the RLS suite or the believable-chain fixture's own
 * assumptions.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbClient, type Database } from "../../src/client.js";
import * as schema from "../../src/schema/index.js";
import * as fixtureId from "../../scripts/data/fixture-ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../../.env") });

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// TENANCY.md §7.4's exact scenario: item base ₹380 (38000 paise), store =
// AMD-1, channel = zomato, daypart = happy_hour, promo = MONSOON20.
export const TEST_ITEM = "00000000-0000-0000-0020-000000000001";
export const TEST_DAYPART_HAPPY_HOUR = "00000000-0000-0000-0020-000000000002";
export const TEST_PROMO_MONSOON20 = "00000000-0000-0000-0020-000000000003";
export const TEST_PROMO_MONSOON20_B = "00000000-0000-0000-0020-000000000004"; // row 21's second promo

// AMD-1 = STORE_AMD_A (the fixture's real Ahmedabad/Brand-A store).
// AMD-2 = STORE_SURAT_A (a different store selling the same brand's item
// — Brand A also sells at Surat — the fixture's stand-in for "AMD-1's
// override doesn't match a DIFFERENT store").
export const STORE_AMD1 = fixtureId.STORE_AMD_A;
export const STORE_AMD2 = fixtureId.STORE_SURAT_A;

let db: Database;

export function getDb(): Database {
  if (!db) db = createDbClient(TEST_DATABASE_URL);
  return db;
}

export async function seedOverrideFixture(): Promise<void> {
  const database = getDb();
  // The believable-chain seed already created BRAND_A/STORE_AMD_A/
  // STORE_SURAT_A/TAX_FOOD5_ORG1 — this suite only adds its own
  // dedicated item + daypart + promos on top, and cleans up after itself.
  await database.execute(`delete from menu_item_overrides where menu_item_id = '${TEST_ITEM}'`);
  await database.execute(`delete from menu_items where id = '${TEST_ITEM}'`);
  await database.execute(`delete from dayparts where id = '${TEST_DAYPART_HAPPY_HOUR}'`);
  await database.execute(`delete from promos where id in ('${TEST_PROMO_MONSOON20}', '${TEST_PROMO_MONSOON20_B}')`);

  await database.insert(schema.menuItems).values([{
    id: TEST_ITEM, brandId: fixtureId.BRAND_A, name: "TEST: Butter Chicken (override suite)",
    basePricePaise: 38000n, taxClassId: fixtureId.TAX_FOOD5_ORG1, diet: "non_veg", status: "published",
  }]);

  // 17:00-19:00, every day — controlled precisely via resolve_menu()'s
  // explicit `at` timestamp parameter, not real wall-clock time.
  await database.insert(schema.dayparts).values([{
    id: TEST_DAYPART_HAPPY_HOUR, brandId: fixtureId.BRAND_A, code: "test_happy_hour", name: "Test Happy Hour",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "17:00:00", endTime: "19:00:00",
  }]);

  await database.insert(schema.promos).values([
    { id: TEST_PROMO_MONSOON20, brandId: fixtureId.BRAND_A, code: "TEST_MONSOON20", name: "Test Monsoon 20", startsAt: new Date(Date.now() - 86400000), status: "active" },
    { id: TEST_PROMO_MONSOON20_B, brandId: fixtureId.BRAND_A, code: "TEST_MONSOON20_B", name: "Test Monsoon 20 (B)", startsAt: new Date(Date.now() - 86400000), status: "active" },
  ]);
}

export type OverrideRow = {
  store?: boolean;
  channel?: "zomato";
  daypart?: boolean;
  promo?: "A" | "B";
  price?: number; // rupees; undefined = don't set price on this row
  available?: boolean; // undefined = don't set availability on this row
  effectiveFrom?: Date;
  publishedAt?: Date;
};

/** Replaces the test item's overrides with EXACTLY the given set. */
export async function setOverrides(rows: OverrideRow[]): Promise<void> {
  const database = getDb();
  await database.execute(`delete from menu_item_overrides where menu_item_id = '${TEST_ITEM}'`);
  if (rows.length === 0) return;
  await database.insert(schema.menuItemOverrides).values(
    rows.map((r) => ({
      id: crypto.randomUUID(),
      menuItemId: TEST_ITEM,
      storeId: r.store ? STORE_AMD1 : null,
      channelCode: r.channel ?? null,
      daypartId: r.daypart ? TEST_DAYPART_HAPPY_HOUR : null,
      promoId: r.promo === "A" ? TEST_PROMO_MONSOON20 : r.promo === "B" ? TEST_PROMO_MONSOON20_B : null,
      pricePaise: r.price !== undefined ? BigInt(r.price * 100) : null,
      isAvailable: r.available ?? null,
      effectiveFrom: r.effectiveFrom ?? new Date(Date.now() - 86400000),
      status: "published" as const,
      publishedAt: r.publishedAt ?? new Date(),
    })),
  );
}

export type Resolved = { pricePaise: bigint | null; isAvailable: boolean | null };

/** Resolves the test item via the real resolve_menu() SQL function. */
export async function resolve(storeId: string, channel: string, at: Date): Promise<Resolved | undefined> {
  const database = getDb();
  const result = await database.execute<{ price_paise: string; is_available: boolean }>(
    `select price_paise, is_available from resolve_menu('${storeId}', '${channel}', '${at.toISOString()}'::timestamptz) where menu_item_id = '${TEST_ITEM}'`,
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return { pricePaise: BigInt(row.price_paise), isAvailable: row.is_available };
}

/** A timestamp guaranteed inside the test daypart's 17:00-19:00 IST window. */
export function duringHappyHour(): Date {
  const d = new Date();
  d.setUTCHours(12, 30, 0, 0); // 12:30 UTC = 18:00 IST
  return d;
}

/** A timestamp guaranteed outside the daypart window. */
export function outsideHappyHour(): Date {
  const d = new Date();
  d.setUTCHours(9, 30, 0, 0); // 09:30 UTC = 15:00 IST
  return d;
}
