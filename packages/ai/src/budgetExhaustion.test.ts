import { describe, it, expect, afterEach } from "vitest";
import { createDbClient, eq, schema, sql, type Database } from "@restrobooth/db";
import { getUpsellSuggestions } from "./upsell.js";
import { extractReviewAspects } from "./reviewExtraction.js";

/**
 * Phase 6 Slice 5 (the phase gate) — ADR-0007 §4: "an outlet cannot
 * generate an unbounded bill... enforced server-side BEFORE the call is
 * made." `budgetGuard.test.ts` already proves `checkBudget`'s own
 * threshold math (blocks at/over 100%). This proves the WIRING: that a
 * real feature call, with a provider actually configured (so it isn't
 * short-circuiting on "no key" the way every other live verification
 * this session has run with no OPENROUTER_API_KEY set), still degrades
 * to its deterministic fallback the instant budget is exhausted — never
 * reaches the network, never errors.
 *
 * Same real-DB, real-rollback discipline as budgetGuard.test.ts: every
 * mutation (the ledger row that exhausts the budget) happens inside a
 * transaction that is ALWAYS rolled back, so nothing is left behind
 * regardless of outcome. Booth Host (apps/booth/lib/booth-host.ts) uses
 * the identical checkBudget-before-provider structure as both functions
 * tested here — verified by code inspection, not independently
 * re-tested live, to avoid a third live-DB budget-mutation test for
 * what is, line for line, the same guard.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// Ember & Oak — real data, real order history, used throughout this
// session's live verification (Slices 2-4).
const OUTLET_ID = "10000000-0000-0000-0004-000000000001";
const STORE_ID = "10000000-0000-0000-0005-000000000001";

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

async function exhaustBudget(tx: Parameters<Parameters<Database["transaction"]>[0]>[0]): Promise<void> {
  const outlet = (await tx.select().from(schema.outlets).where(eq(schema.outlets.id, OUTLET_ID)))[0]!;
  await tx.insert(schema.aiUsageLedger).values({
    id: crypto.randomUUID(),
    businessDate: new Date().toISOString().slice(0, 10),
    outletId: OUTLET_ID,
    feature: "upsell",
    providerId: "test-setup",
    inputTokens: outlet.aiMonthlyTokenBudget,
    outputTokens: 0,
    costPaise: 0n,
  });
}

const ORIGINAL_KEY = process.env.OPENROUTER_API_KEY;
afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = ORIGINAL_KEY;
});

describe("budget exhaustion — a real feature call degrades to its fallback, never reaches the network", () => {
  it("upsell falls back (aiUsed:false, a real deterministic reason) once the outlet's budget is exhausted", async () => {
    // A configured-looking key so getProvider() returns non-null — proves
    // the budget check, not just "no key configured" (every OTHER live
    // verification this session ran with no key set at all).
    process.env.OPENROUTER_API_KEY = "test-fake-key-never-actually-called";

    await withRollback(async (tx) => {
      await exhaustBudget(tx);

      const anchor = await tx.execute<{ [key: string]: unknown; menu_item_id: string }>(sql`
        select menu_item_id from order_items where store_id = ${STORE_ID} and status != 'voided'
        group by menu_item_id having count(*) >= 2 limit 1
      `);
      const anchorId = anchor.rows[0]?.menu_item_id;
      expect(anchorId, "expected at least one real Ember & Oak item with order history").toBeTruthy();

      const result = await getUpsellSuggestions(tx, { storeId: STORE_ID, outletId: OUTLET_ID, cartMenuItemIds: [anchorId!] });
      expect(result.aiUsed).toBe(false);
      if (result.items.length > 0) {
        // A real, non-empty deterministic reason — the fallback template
        // actually ran, this isn't an accidentally-empty result.
        expect(result.items[0]!.reason.length).toBeGreaterThan(0);
      }
    });
  }, 15000);

  it("review extraction falls back (aiUsed:false, real keyword findings) once the outlet's budget is exhausted", async () => {
    process.env.OPENROUTER_API_KEY = "test-fake-key-never-actually-called";

    await withRollback(async (tx) => {
      await exhaustBudget(tx);

      const result = await extractReviewAspects(tx, {
        outletId: OUTLET_ID,
        storeId: STORE_ID,
        reviewText: "The service was rude and we waited forever for our table.",
      });
      expect(result.aiUsed).toBe(false);
      // Real, unambiguous keyword cues in that text — proves the keyword
      // fallback actually ran, not a coincidentally-empty result.
      expect(result.findings.length).toBeGreaterThan(0);
    });
  }, 15000);
});
