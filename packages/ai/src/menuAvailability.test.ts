import { describe, it, expect } from "vitest";
import { createDbClient, eq, schema, type Database } from "@restrobooth/db";
import { getUpsellSuggestions } from "./upsell.js";

/**
 * Phase 6 Slice 5 (the phase gate): "an 86'd dish never recommended."
 * Proven live, on real data: 86 a real Ember & Oak dish that's a known
 * real upsell candidate (Prawn Cocktail, real historical co-occurrence
 * with Filet Mignon — verified via live Playwright testing in Slice 3/4),
 * then confirm it never surfaces even though the underlying market-basket
 * lift is still real. The override is written inside a transaction that
 * is ALWAYS rolled back (same discipline as budgetGuard.test.ts /
 * budgetExhaustion.test.ts) — nothing is left behind on Ember & Oak's
 * real menu regardless of outcome.
 *
 * `getRankedCandidates` in both upsell.ts (`join resolve_menu(...) rm ...
 * where rm.is_available`) and apps/booth/lib/booth-host.ts (`from
 * resolve_menu(...) rm ... where rm.is_available`) join through the exact
 * same `resolve_menu()`/`is_available` structure — proven once here for
 * the injectable, packages/ai-shared function; Booth Host's identical
 * clause is verified by code inspection (its own `getDb()` singleton
 * isn't designed to accept an injected transaction, so re-running the
 * identical proof against it would need a real committed mutation
 * instead of a safe rollback — not worth the added risk for a
 * structurally identical guard).
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const STORE_ID = "10000000-0000-0000-0005-000000000001"; // Ember & Oak
const OUTLET_ID = "10000000-0000-0000-0004-000000000001";

const db: Database = createDbClient(TEST_DATABASE_URL);

class RollbackForTest extends Error {}
async function withRollback(fn: (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<void>) {
  try {
    await db.transaction(async (tx) => {
      await fn(tx);
      throw new RollbackForTest();
    });
  } catch (err) {
    if (!(err instanceof RollbackForTest)) throw err;
  }
}

describe("an 86'd dish is never recommended", () => {
  it("upsell excludes a candidate the instant it's 86'd, even with real co-occurrence history", async () => {
    await withRollback(async (tx) => {
      const [filet] = await tx.select({ id: schema.menuItems.id }).from(schema.menuItems).where(eq(schema.menuItems.name, "Filet Mignon"));
      const [prawn] = await tx.select({ id: schema.menuItems.id }).from(schema.menuItems).where(eq(schema.menuItems.name, "Prawn Cocktail"));
      expect(filet, "expected Filet Mignon on Ember & Oak's real menu").toBeTruthy();
      expect(prawn, "expected Prawn Cocktail on Ember & Oak's real menu").toBeTruthy();

      const before = await getUpsellSuggestions(tx, { storeId: STORE_ID, outletId: OUTLET_ID, cartMenuItemIds: [filet!.id] });
      const beforeHasPrawn = before.items.some((i) => i.menuItemId === prawn!.id);
      expect(beforeHasPrawn, "expected Prawn Cocktail to be a real upsell candidate before it's 86'd").toBe(true);

      // Postgres's now() is frozen at transaction START, not per-statement
      // — resolve_menu() defaults p_at to now(), so an effectiveFrom timed
      // AFTER that frozen snapshot (e.g. captured client-side once the
      // transaction is already open) reads as "not yet effective" and is
      // silently excluded. Backdating well past any such skew avoids it.
      await tx.insert(schema.menuItemOverrides).values({
        id: crypto.randomUUID(),
        menuItemId: prawn!.id,
        storeId: STORE_ID,
        isAvailable: false,
        effectiveFrom: new Date(Date.now() - 60 * 60 * 1000),
        status: "published",
        publishedAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const after = await getUpsellSuggestions(tx, { storeId: STORE_ID, outletId: OUTLET_ID, cartMenuItemIds: [filet!.id] });
      const afterHasPrawn = after.items.some((i) => i.menuItemId === prawn!.id);
      expect(afterHasPrawn, "86'd item must never appear in suggestions, real lift or not").toBe(false);
    });
  }, 15000);
});
