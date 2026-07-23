import { describe, it, expect } from "vitest";
import { createDbClient, eq, schema, type Database } from "@restrobooth/db";
import { checkBudget, recordUsage } from "./budgetGuard.js";

// Same local Supabase stack the rest of this repo's manual/scripted
// verification runs against this session (54322, not the docker-compose
// bench DB on 54329 — the seeded outlet below only exists there).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
// Ahmedabad — Vastrapur, the believable-chain seed's pilot outlet, used
// throughout this session's manual verification. A real, shared row —
// see the `db.transaction(...tx.rollback())` note below for why tests
// against it never leave anything behind, pass or fail.
const OUTLET_ID = "00000000-0000-0000-0004-00000000000a";

const db: Database = createDbClient(TEST_DATABASE_URL);

/** A sentinel we throw ourselves and catch by identity — drizzle's own
 *  `tx.rollback()` re-throws a DrizzleError to the transaction() caller
 *  in this version rather than resolving silently, so relying on it
 *  directly would make every passing test look like a thrown failure.
 *  Own sentinel = predictable, version-independent control instead. */
class RollbackForTest extends Error {}

/** Runs `fn` inside a transaction that is ALWAYS rolled back — on
 *  success via the sentinel thrown at the end, on a failing assertion
 *  via THAT error triggering rollback and then propagating to vitest
 *  (never swallowed — only RollbackForTest is). Nothing this file does
 *  to the shared seeded outlet's budget state is ever left behind,
 *  regardless of outcome — no afterEach, no manual id-tracking, no risk
 *  of orphaned rows if a test crashes instead of failing cleanly. */
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

describe("checkBudget / recordUsage", () => {
  it("allows a call when usage is well under budget", async () => {
    await withRollback(async (tx) => {
      const status = await checkBudget(tx, OUTLET_ID);
      expect(status.allowed).toBe(true);
      expect(status.budgetTokens).toBeGreaterThan(0);
    });
  });

  it("recordUsage increases the running total checkBudget sees", async () => {
    await withRollback(async (tx) => {
      const before = await checkBudget(tx, OUTLET_ID);

      await tx.insert(schema.aiUsageLedger).values({
        id: crypto.randomUUID(),
        businessDate: new Date().toISOString().slice(0, 10),
        outletId: OUTLET_ID,
        feature: "booth_host",
        providerId: "stub",
        inputTokens: 1000,
        outputTokens: 500,
        costPaise: 0n,
      });

      const after = await checkBudget(tx, OUTLET_ID);
      expect(after.usedTokens).toBe(before.usedTokens + 1500);
    });
  });

  it("recordUsage() writes a row visible via the public helper, not just raw insert", async () => {
    await withRollback(async (tx) => {
      const before = await checkBudget(tx, OUTLET_ID);

      await recordUsage(tx, {
        outletId: OUTLET_ID,
        businessDate: new Date().toISOString().slice(0, 10),
        feature: "upsell",
        providerId: "stub",
        inputTokens: 200,
        outputTokens: 100,
        costPaise: 0n,
      });

      const after = await checkBudget(tx, OUTLET_ID);
      expect(after.usedTokens).toBe(before.usedTokens + 300);
    });
  });

  it("blocks once usage reaches the outlet's configured budget (the hard 100% stop, ADR-0007 §4)", async () => {
    await withRollback(async (tx) => {
      const outlet = (await tx.select().from(schema.outlets).where(eq(schema.outlets.id, OUTLET_ID)))[0]!;
      const before = await checkBudget(tx, OUTLET_ID);
      const remaining = before.budgetTokens - before.usedTokens;

      // Push usage to exactly the budget ceiling.
      await tx.insert(schema.aiUsageLedger).values({
        id: crypto.randomUUID(),
        businessDate: new Date().toISOString().slice(0, 10),
        outletId: OUTLET_ID,
        feature: "booth_host",
        providerId: "stub",
        inputTokens: Math.max(remaining, 0),
        outputTokens: 0,
        costPaise: 0n,
      });

      const after = await checkBudget(tx, OUTLET_ID);
      expect(after.usedTokens).toBeGreaterThanOrEqual(outlet.aiMonthlyTokenBudget);
      expect(after.allowed).toBe(false);
      expect(after.percentUsed).toBeGreaterThanOrEqual(100);
    });
  });
});
