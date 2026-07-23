import { describe, it, expect } from "vitest";
import { createDbClient, type Database } from "@restrobooth/db";
import { cacheKey, getCached, setCached } from "./cache.js";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("cacheKey", () => {
  it("is deterministic for the same feature + parts", () => {
    expect(cacheKey("booth_host", ["store-1", "v3"])).toBe(cacheKey("booth_host", ["store-1", "v3"]));
  });

  it("changes when any part changes — this is what makes menu_version invalidation automatic (ADR-0007 §5)", () => {
    const beforePublish = cacheKey("booth_host", ["store-1", "menu-v3"]);
    const afterPublish = cacheKey("booth_host", ["store-1", "menu-v4"]);
    expect(beforePublish).not.toBe(afterPublish);
  });

  it("changes when the feature changes, even with identical parts — no cross-feature collisions", () => {
    expect(cacheKey("booth_host", ["store-1"])).not.toBe(cacheKey("upsell", ["store-1"]));
  });

  it("treats null and undefined parts consistently", () => {
    expect(cacheKey("booth_host", ["store-1", null])).toBe(cacheKey("booth_host", ["store-1", undefined]));
  });
});

describe("getCached / setCached", () => {
  const db: Database = createDbClient(TEST_DATABASE_URL);

  /** Own sentinel, not drizzle's `tx.rollback()` — see
   *  budgetGuard.test.ts's identical helper for why. Always rolled back,
   *  pass or fail, so no test run leaves rows behind in
   *  ai_response_cache. */
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

  it("returns null on a miss", async () => {
    await withRollback(async (tx) => {
      const key = cacheKey("booth_host", ["never-set", crypto.randomUUID()]);
      expect(await getCached(tx, key)).toBeNull();
    });
  });

  it("returns what was set", async () => {
    await withRollback(async (tx) => {
      const key = cacheKey("booth_host", [crypto.randomUUID()]);
      await setCached(tx, key, "booth_host", "cached response text", 60_000);
      expect(await getCached(tx, key)).toBe("cached response text");
    });
  });

  it("an expired entry reads back as a miss, not a stale hit", async () => {
    await withRollback(async (tx) => {
      const key = cacheKey("booth_host", [crypto.randomUUID()]);
      await setCached(tx, key, "booth_host", "stale response", -1000); // already expired
      expect(await getCached(tx, key)).toBeNull();
    });
  });

  it("setCached upserts — a second write for the same key replaces the first", async () => {
    await withRollback(async (tx) => {
      const key = cacheKey("booth_host", [crypto.randomUUID()]);
      await setCached(tx, key, "booth_host", "first", 60_000);
      await setCached(tx, key, "booth_host", "second", 60_000);
      expect(await getCached(tx, key)).toBe("second");
    });
  });
});
