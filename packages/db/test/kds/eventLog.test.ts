/**
 * ADR-0005 §1's sequence-numbered event log — the mechanism a KDS
 * reconnect catches up from. Two things must hold and both are "things
 * that break", not CRUD glue:
 *
 *  1. `next_outlet_event_seq` is gapless and duplicate-free under real
 *     concurrency. A gap or a collision here is silently indistinguishable
 *     from a lost ticket on the client — this is the whole guarantee.
 *  2. `emitOrderStatusEvent` writes what the KDS needs to act without a
 *     second query, and is RLS-isolated the same as every other outlet-
 *     scoped table.
 *
 * Writes go through withUser() — the same primitive the real fire/reprint
 * Server Actions use — so this exercises the real committed path.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { eq, sql } from "drizzle-orm";
import { createDbClient, type Database } from "../../src/client.js";
import { withUser, type RlsTx } from "../../src/rls.js";
import { emitOrderStatusEvent } from "../../src/orderStatusEvents.js";
import * as schema from "../../src/schema/index.js";
import * as id from "../../scripts/data/fixture-ids.js";
import { asUser, makeClient, TEST_DATABASE_URL } from "../rls/fixtures.js";

const TEST_KOT_ID = "00000000-0000-0000-0031-000000000001";

let db: Database;
let client: pg.Client;

async function nextSeq(tx: RlsTx, outletId: string): Promise<bigint> {
  const r = await tx.execute<{ [key: string]: unknown; seq: string }>(sql`select next_outlet_event_seq(${outletId}) as seq`);
  return BigInt(r.rows[0]!.seq);
}

beforeAll(async () => {
  db = createDbClient(TEST_DATABASE_URL);
  client = makeClient();
  await client.connect();
});

afterAll(async () => {
  await db.execute(`delete from order_status_events where entity_id = '${TEST_KOT_ID}'`);
  await client.end();
});

describe("next_outlet_event_seq is gapless and duplicate-free under concurrency", () => {
  test("sequential calls on the same outlet return 1, 2, 3, ...", async () => {
    const seqs: bigint[] = [];
    await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
      for (let i = 0; i < 5; i++) seqs.push(await nextSeq(tx, id.OUTLET_AMD));
    });
    // Only assert monotonic-by-1 relative to the FIRST call in this test —
    // the counter is shared with the rest of the suite (seeded fixture
    // narratives already advanced it), so an absolute starting value isn't
    // a safe assertion.
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1n);
    }
  });

  test("50 concurrent callers on the same outlet get 50 distinct, contiguous sequence numbers", async () => {
    const calls = Array.from({ length: 50 }, () => withUser(db, id.USER_ORG1_OWNER, (tx) => nextSeq(tx, id.OUTLET_AMD)));
    const seqs = await Promise.all(calls);

    const distinct = new Set(seqs.map(String));
    expect(distinct.size).toBe(50); // zero collisions

    const sorted = [...seqs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]).toBe(sorted[i - 1]! + 1n); // zero gaps
    }
  });

  test("a different outlet's sequence is independent (its own counter, not shared)", async () => {
    const seqA1 = await withUser(db, id.USER_ORG1_OWNER, (tx) => nextSeq(tx, id.OUTLET_AMD));
    await withUser(db, id.USER_ORG2_OWNER, (tx) => nextSeq(tx, id.OUTLET_BLR));
    const seqA2 = await withUser(db, id.USER_ORG1_OWNER, (tx) => nextSeq(tx, id.OUTLET_AMD));
    // AMD's second call is exactly +1 from its first, regardless of
    // whatever BLR's own counter happened to do in between.
    expect(seqA2).toBe(seqA1 + 1n);
  });
});

describe("emitOrderStatusEvent writes what a KDS needs, RLS-isolated", () => {
  test("writes one row with the right entity, event type, and payload", async () => {
    await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
      await emitOrderStatusEvent(tx, {
        outletId: id.OUTLET_AMD,
        businessDate: "2026-07-18",
        entityType: "kot",
        entityId: TEST_KOT_ID,
        eventType: "kot.fired",
        payload: { kitchenSection: "hot", kotNumber: 7 },
      });
    });

    const rows = await withUser(db, id.USER_ORG1_OWNER, (tx) =>
      tx.select().from(schema.orderStatusEvents).where(eq(schema.orderStatusEvents.entityId, TEST_KOT_ID)),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.entityType).toBe("kot");
    expect(row.eventType).toBe("kot.fired");
    expect(row.outletId).toBe(id.OUTLET_AMD);
    expect(row.payload).toEqual({ kitchenSection: "hot", kotNumber: 7 });
    expect(row.eventSeq).toBeGreaterThan(0n);
  });

  test("a franchisee from a different org reads zero of these events", async () => {
    const rows = await asUser(client, id.USER_ORG2_OWNER, async (c) => {
      const r = await c.query("select * from order_status_events where entity_id = $1", [TEST_KOT_ID]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("brand A's own owner CAN read it (positive control — proves isolation discriminates)", async () => {
    const rows = await asUser(client, id.USER_ORG1_OWNER, async (c) => {
      const r = await c.query("select * from order_status_events where entity_id = $1", [TEST_KOT_ID]);
      return r.rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  test("two events for the same outlet get increasing, never-equal event_seq", async () => {
    let seq1 = 0n;
    let seq2 = 0n;
    await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
      seq1 = await emitOrderStatusEvent(tx, {
        outletId: id.OUTLET_AMD,
        businessDate: "2026-07-18",
        entityType: "kot",
        entityId: TEST_KOT_ID,
        eventType: "kot.reprinted",
        payload: { reprintCount: 1 },
      });
    });
    await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
      seq2 = await emitOrderStatusEvent(tx, {
        outletId: id.OUTLET_AMD,
        businessDate: "2026-07-18",
        entityType: "kot",
        entityId: TEST_KOT_ID,
        eventType: "kot.reprinted",
        payload: { reprintCount: 2 },
      });
    });
    expect(seq2).toBeGreaterThan(seq1);
  });
});
