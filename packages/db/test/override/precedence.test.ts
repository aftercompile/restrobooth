/**
 * The 21-row override precedence table, transcribed verbatim from
 * docs/TENANCY.md §7.4. Each row gets its OWN exact override set (the
 * table is not a monotonic build-up — rows 9, 13, 14, 15 drop earlier
 * rows, they don't just add to them), then calls the real resolve_menu()
 * SQL function and asserts price_paise / is_available.
 *
 * Rows 8, 12, 17, and 21 are the ones TENANCY.md calls out as what a
 * naive implementation gets wrong. Row 20 proves effective-dating.
 */
import { beforeAll, describe, expect, test } from "vitest";
import {
  duringHappyHour,
  getDb,
  outsideHappyHour,
  resolve,
  seedOverrideFixture,
  setOverrides,
  STORE_AMD1,
  STORE_AMD2,
} from "./fixtures.js";

beforeAll(async () => {
  await seedOverrideFixture();
}, 60_000);

// Brand default, no overrides at all.
test("row 1: no overrides -> brand default 380", async () => {
  const r = await resolve(STORE_AMD1, "dinein", outsideHappyHour());
  expect(r?.pricePaise).toBe(38000n);
});

test("row 2: S only, matching store -> 400", async () => {
  await setOverrides([{ store: true, price: 400 }]);
  const r = await resolve(STORE_AMD1, "dinein", outsideHappyHour());
  expect(r?.pricePaise).toBe(40000n);
});

test("row 3: S only, different store -> default 380 (S doesn't match)", async () => {
  await setOverrides([{ store: true, price: 400 }]);
  const r = await resolve(STORE_AMD2, "dinein", outsideHappyHour());
  expect(r?.pricePaise).toBe(38000n);
});

test("row 4: C only, matching channel -> 450", async () => {
  await setOverrides([{ channel: "zomato", price: 450 }]);
  const r = await resolve(STORE_AMD1, "zomato", outsideHappyHour());
  expect(r?.pricePaise).toBe(45000n);
});

test("row 5: C only, different channel -> default 380 (C doesn't match)", async () => {
  await setOverrides([{ channel: "zomato", price: 450 }]);
  const r = await resolve(STORE_AMD1, "dinein", outsideHappyHour());
  expect(r?.pricePaise).toBe(38000n);
});

test("row 6: S, C -> C (spec 2) beats S (spec 1) -> 450", async () => {
  await setOverrides([
    { store: true, price: 400 },
    { channel: "zomato", price: 450 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", outsideHappyHour());
  expect(r?.pricePaise).toBe(45000n);
});

test("row 7: S, C, SC -> SC (spec 3) beats both -> 460", async () => {
  await setOverrides([
    { store: true, price: 400 },
    { channel: "zomato", price: 450 },
    { store: true, channel: "zomato", price: 460 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", outsideHappyHour());
  expect(r?.pricePaise).toBe(46000n);
});

test("row 8: S, C, SC, D -> D (spec 4) beats SC (spec 3) — daypart outranks store+channel -> 340", async () => {
  await setOverrides([
    { store: true, price: 400 },
    { channel: "zomato", price: 450 },
    { store: true, channel: "zomato", price: 460 },
    { daypart: true, price: 340 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(34000n);
});

test("row 9: SC, SD -> SD (spec 5) beats SC (spec 3) -> 350", async () => {
  await setOverrides([
    { store: true, channel: "zomato", price: 460 },
    { store: true, daypart: true, price: 350 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(35000n);
});

test("row 10: SD, CD -> CD (spec 6) beats SD (spec 5) -> 420", async () => {
  await setOverrides([
    { store: true, daypart: true, price: 350 },
    { channel: "zomato", daypart: true, price: 420 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(42000n);
});

test("row 11: SD, CD, SCD -> SCD (spec 7), most specific non-promo -> 430", async () => {
  await setOverrides([
    { store: true, daypart: true, price: 350 },
    { channel: "zomato", daypart: true, price: 420 },
    { store: true, channel: "zomato", daypart: true, price: 430 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(43000n);
});

test("row 12: SCD, P -> P (spec 8) beats SCD (spec 7) — promo outranks everything below it -> 320", async () => {
  await setOverrides([
    { store: true, channel: "zomato", daypart: true, price: 430 },
    { promo: "A", price: 320 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(32000n);
});

test("row 13: P, SP -> SP (spec 9) -> 330", async () => {
  await setOverrides([
    { promo: "A", price: 320 },
    { store: true, promo: "A", price: 330 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(33000n);
});

test("row 14: SP, CP -> CP (spec 10) -> 410", async () => {
  await setOverrides([
    { store: true, promo: "A", price: 330 },
    { channel: "zomato", promo: "A", price: 410 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(41000n);
});

test("row 15: CP, SCP, DP -> DP (spec 12) beats SCP (spec 11) -> 300", async () => {
  await setOverrides([
    { channel: "zomato", promo: "A", price: 410 },
    { store: true, channel: "zomato", promo: "A", price: 415 },
    { daypart: true, promo: "A", price: 300 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(30000n);
});

test("row 16: all 15 rows -> SCDP (spec 15), the maximum -> 425", async () => {
  await setOverrides([
    { store: true, price: 400 },
    { channel: "zomato", price: 450 },
    { store: true, channel: "zomato", price: 460 },
    { daypart: true, price: 340 },
    { store: true, daypart: true, price: 350 },
    { channel: "zomato", daypart: true, price: 420 },
    { store: true, channel: "zomato", daypart: true, price: 430 },
    { promo: "A", price: 320 },
    { store: true, promo: "A", price: 330 },
    { channel: "zomato", promo: "A", price: 410 },
    { store: true, channel: "zomato", promo: "A", price: 415 },
    { daypart: true, promo: "A", price: 300 },
    { store: true, daypart: true, promo: "A", price: 310 },
    { channel: "zomato", daypart: true, promo: "A", price: 405 },
    { store: true, channel: "zomato", daypart: true, promo: "A", price: 425 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", duringHappyHour());
  expect(r?.pricePaise).toBe(42500n);
});

test("row 17: S(400) + SC(unavailable, no price) -> price and availability resolve INDEPENDENTLY -> 400, unavailable", async () => {
  // The 86 must not erase the price override: SC's own price is null, so
  // it never enters the price CTE at all — S (spec 1) wins price by being
  // the only candidate with a non-null price_paise. SC (spec 3) wins
  // availability by being the only candidate with a non-null is_available.
  await setOverrides([
    { store: true, price: 400 },
    { store: true, channel: "zomato", available: false },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", outsideHappyHour());
  expect(r?.pricePaise).toBe(40000n);
  expect(r?.isAvailable).toBe(false);
});

// Row 18 as TENANCY.md literally describes it ("row SD with price=NULL,
// is_available=NULL") cannot be reproduced as data: the
// "overrides_something" check constraint (schema/menu.ts) requires every
// override row to set at least one of price_paise / is_available. That
// constraint was added in Phase 1, after TENANCY.md was written, and it
// makes the property TENANCY.md's test was probing ("an all-null override
// row is inert, not a reset-to-default") true BY CONSTRUCTION — such a row
// can never exist, so the resolver never has to prove it treats one as
// inert. Testing that the insert itself is rejected is the more accurate
// verification of the same invariant.
test("row 18: an all-null override row cannot be persisted (overrides_something check)", async () => {
  const db = getDb();
  await db.execute(`delete from menu_item_overrides where menu_item_id = (select id from menu_items where name = 'TEST: Butter Chicken (override suite)')`);
  await expect(
    setOverrides([
      { daypart: true, price: 340 },
      { store: true, daypart: true }, // price undefined, available undefined -> both null
    ]),
  ).rejects.toThrow();
});

test("row 19: all 15 rows, but query outside the daypart window -> daypart rows drop out entirely -> SCP (spec 11) -> 415", async () => {
  await setOverrides([
    { store: true, price: 400 },
    { channel: "zomato", price: 450 },
    { store: true, channel: "zomato", price: 460 },
    { daypart: true, price: 340 },
    { store: true, daypart: true, price: 350 },
    { channel: "zomato", daypart: true, price: 420 },
    { store: true, channel: "zomato", daypart: true, price: 430 },
    { promo: "A", price: 320 },
    { store: true, promo: "A", price: 330 },
    { channel: "zomato", promo: "A", price: 410 },
    { store: true, channel: "zomato", promo: "A", price: 415 },
    { daypart: true, promo: "A", price: 300 },
    { store: true, daypart: true, promo: "A", price: 310 },
    { channel: "zomato", daypart: true, promo: "A", price: 405 },
    { store: true, channel: "zomato", daypart: true, promo: "A", price: 425 },
  ]);
  const r = await resolve(STORE_AMD1, "zomato", outsideHappyHour());
  expect(r?.pricePaise).toBe(41500n);
});

describe("row 20: effective-dating excludes a future row today, includes it tomorrow", () => {
  const now = outsideHappyHour();
  const effectiveFrom = new Date(now.getTime() + 24 * 3600 * 1000);
  const tomorrowQuery = new Date(now.getTime() + 25 * 3600 * 1000);

  test("today: not yet effective -> default 380", async () => {
    await setOverrides([{ store: true, price: 400, effectiveFrom }]);
    const r = await resolve(STORE_AMD1, "dinein", now);
    expect(r?.pricePaise).toBe(38000n);
  });

  test("tomorrow: same query, now effective -> 400", async () => {
    await setOverrides([{ store: true, price: 400, effectiveFrom }]);
    const r = await resolve(STORE_AMD1, "dinein", tomorrowQuery);
    expect(r?.pricePaise).toBe(40000n);
  });
});

test("row 21: two active promos at the same specificity -> tie breaks on published_at DESC -> 315", async () => {
  const earlier = new Date(Date.now() - 3600 * 1000);
  const later = new Date();
  await setOverrides([
    { promo: "A", price: 320, publishedAt: earlier },
    { promo: "B", price: 315, publishedAt: later },
  ]);
  const r = await resolve(STORE_AMD1, "dinein", outsideHappyHour());
  expect(r?.pricePaise).toBe(31500n);
});
