/**
 * The 15-case RLS adversarial suite, transcribed verbatim from
 * docs/TENANCY.md §6. Every case must DENY (return 0 rows / 0 affected /
 * reject), except A12 which is a positive case (anon reads published
 * menu items). Runs against the Supabase local stack's real GoTrue-backed
 * auth.uid() — see fixtures.ts for why.
 *
 * A6, A7, A9 are ROLE-CAPABILITY concerns, not tenant-scope ones. Phase 1
 * deliberately enforced tenant ISOLATION only and left the CAPABILITY
 * matrix for later phases, built incrementally as each phase's own code
 * path came into existence: A6/A9 in Phase 2 (drizzle/0012), A7 in Phase 3b
 * (drizzle/0017, once bill creation existed at all to enforce a rule
 * against). All three are un-skipped below.
 *
 * A14 (QR token replay) is un-skipped as of Phase 5 (ADR-0008) — see its
 * own describe block below. It exercises the REAL
 * packages/db/src/guestToken.ts functions against real minted/looked-up
 * rows; the pure denial RULE itself (packages/domain/src/qrToken.ts) is
 * exhaustively tested in its own package and wired end-to-end in
 * apps/booth/app/t/[token]/route.ts — see that describe block's own
 * comment for why this suite doesn't import packages/domain directly.
 */
import { beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { eq } from "drizzle-orm";
import * as id from "../../scripts/data/fixture-ids.js";
import { createDbClient, type Database } from "../../src/client.js";
import { hashToken, lookupTokenByHash, mintTableToken } from "../../src/guestToken.js";
import * as schema from "../../src/schema/index.js";
import { asGuest, asUser, makeClient, TEST_DATABASE_URL } from "./fixtures.js";

let client: pg.Client;
let db: Database;

beforeAll(async () => {
  client = makeClient();
  await client.connect();
  db = createDbClient(TEST_DATABASE_URL);
}, 60_000);

describe("A1-A2: cashier @ outlet:AMD is confined to AMD", () => {
  test("A1: reading another outlet's bills by id returns 0 rows", async () => {
    const rows = await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const r = await c.query("select * from bills where outlet_id = $1", [id.OUTLET_MUM]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("A2: reading bills with no filter returns only AMD rows", async () => {
    const rows = await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const r = await c.query("select outlet_id from bills");
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.outlet_id === id.OUTLET_AMD)).toBe(true);
  });
});

describe("A3-A4: cluster_manager @ group:WEST cannot touch EAST (MUM)", () => {
  test("A3: reading outlets outside the group returns 0 rows", async () => {
    const rows = await asUser(client, id.USER_WEST_CLUSTER, async (c) => {
      const r = await c.query("select * from outlets where id = $1", [id.OUTLET_MUM]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("A4: updating an out-of-group outlet affects 0 rows", async () => {
    const affected = await asUser(client, id.USER_WEST_CLUSTER, async (c) => {
      const r = await c.query("update outlets set name = name where id = $1", [id.OUTLET_MUM]);
      return r.rowCount;
    });
    expect(affected).toBe(0);
  });
});

test("A5: outlet_manager @ AMD reading memberships of a MUM user returns 0 rows", async () => {
  const rows = await asUser(client, id.USER_AMD_MGR, async (c) => {
    const r = await c.query("select * from memberships where user_id = $1", [id.USER_MUM_CASHIER]);
    return r.rows;
  });
  expect(rows).toHaveLength(0);
});

// docs/TENANCY.md: "cashier attempts a price update -> denied (capability,
// not scope)". Enforced by a trigger, not RLS — the rule is column-scoped
// (price_paise vs is_available on the SAME menu_item_overrides row), which
// plain USING/WITH CHECK can't express. See can_set_menu_price() and
// check_menu_item_override_price_capability() in
// drizzle/0012_menu_capability.sql.
describe("A6: cashier cannot change a price, but CAN 86 an item (capability, not scope)", () => {
  test("A6: cashier setting price_paise is rejected", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const item = await c.query("select id from menu_items where status = 'published' limit 1");
      await expect(
        c.query(
          "insert into menu_item_overrides (id, menu_item_id, price_paise, effective_from, status) values (gen_random_uuid(), $1, 999, now(), 'draft')",
          [item.rows[0].id],
        ),
      ).rejects.toThrow(/insufficient privilege/);
    });
  });

  test("A6b: the SAME cashier setting only is_available succeeds (positive control)", async () => {
    // Without this, A6's denial is meaningless — it could be blocking
    // every write, not just price. A cashier must still be able to 86 an
    // item; that's the entire point of the rule being column-scoped.
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const item = await c.query("select id from menu_items where status = 'published' limit 1");
      const r = await c.query(
        "insert into menu_item_overrides (id, menu_item_id, is_available, effective_from, status) values (gen_random_uuid(), $1, false, now(), 'draft')",
        [item.rows[0].id],
      );
      expect(r.rowCount).toBe(1);
    });
  });

  test("A6c: org_owner setting price_paise succeeds (positive control)", async () => {
    await asUser(client, id.USER_ORG1_OWNER, async (c) => {
      const item = await c.query("select id from menu_items where status = 'published' limit 1");
      const r = await c.query(
        "insert into menu_item_overrides (id, menu_item_id, price_paise, effective_from, status) values (gen_random_uuid(), $1, 999, now(), 'draft')",
        [item.rows[0].id],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

// A7 — TENANCY.md §6: "captain @ outlet:AMD-1, insert into bills(...),
// denied." Phase 3b builds the first real bill-creation code path, so this
// finally has something to enforce against. Enforced by
// bill_take_capability (drizzle/0017) — same financial-capability role set
// as "Settle a bill" in TENANCY.md §4's matrix; captain never appears in
// any billing row.
describe("A7: captain cannot create a bill (capability, not scope)", () => {
  const attemptBillInsert = (c: pg.Client) =>
    c.query(
      `insert into bills
         (id, business_date, outlet_id, store_id, gst_registration_id, terminal_id, status, subtotal_paise, payable_paise, idempotency_key)
       values (gen_random_uuid(), current_date, $1, $2, $3, $4, 'draft', 0, 0, gen_random_uuid())`,
      [id.OUTLET_AMD, id.STORE_AMD_A, id.GST_GJ, id.TERMINAL_AMD_T1],
    );

  test("A7: captain cannot create a bill", async () => {
    await asUser(client, id.USER_AMD_CAPTAIN, async (c) => {
      await expect(attemptBillInsert(c)).rejects.toThrow(/row-level security/);
    });
  });

  test("A7b: cashier CAN create a bill (positive control)", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const r = await attemptBillInsert(c);
      expect(r.rowCount).toBe(1);
    });
  });
});

test("A8: brand_manager @ Brand A cannot read Brand B's orders at the SAME shared outlet", async () => {
  // The case that catches a naive implementation: Surat is one outlet
  // hosting both brands. Outlet-scoping alone would leak this.
  const rows = await asUser(client, id.USER_BRANDA_MGR, async (c) => {
    const r = await c.query("select * from orders where store_id = $1", [id.STORE_SURAT_B]);
    return r.rows;
  });
  expect(rows).toHaveLength(0);
});

// TENANCY.md: "kitchen @ outlet:AMD-1 -> select * from bills -> 0 rows —
// kitchen has no financial read." Enforced by RESTRICTIVE policies on
// bills/bill_tax_lines/payments (drizzle/0012_menu_capability.sql) that
// AND a role check onto the existing scope-based permissive policy.
describe("A9: kitchen role has no financial read (capability, not scope)", () => {
  test("A9: kitchen reads zero rows from bills", async () => {
    const rows = await asUser(client, id.USER_AMD_KITCHEN, async (c) => {
      const r = await c.query("select * from bills");
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("A9b: the same outlet's cashier still reads bills (positive control)", async () => {
    // Proves the restrictive policy discriminates by ROLE, not by
    // accident denying every read at AMD.
    const rows = await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const r = await c.query("select * from bills");
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});

test("A10: a franchisee (org2) user reads 0 rows of org1", async () => {
  const rows = await asUser(client, id.USER_ORG2_OWNER, async (c) => {
    const r = await c.query("select * from outlets where org_id = $1", [id.ORG1]);
    return r.rows;
  });
  expect(rows).toHaveLength(0);
});

describe("A11-A13: anonymous Booth guest at table T5 (AMD)", () => {
  test("A11: guest at T5 reading orders for T6's session returns 0 rows", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query("select * from orders where table_session_id = $1", [id.TABLE_SESSION_AMD_2]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("A11b: guest at T5 CAN read their own table's orders (positive control)", async () => {
    // Not in TENANCY.md's table explicitly, but without this the A11
    // denial is meaningless — it could be denying EVERYTHING, not just
    // T6. Prove the policy discriminates, not just blocks.
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query("select * from orders where table_session_id = $1", [id.TABLE_SESSION_AMD_1]);
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  test("A12: guest CAN read published menu items (positive case)", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query("select * from menu_items where status = 'published' limit 5");
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  test("A13: guest reading bills returns 0 rows", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query("select * from bills");
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("A13b: guest reading memberships returns 0 rows", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query("select * from memberships");
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  // docs/TENANCY.md's A13 also names "stock_ledger" — inventory is
  // Phase 8 scope; that table doesn't exist yet. Nothing to test.

  // Phase 5 Slice 2a additions — migration 0026's order_item_guest_own_read
  // and kot_guest_own_read, the live status board's read policies. Not in
  // TENANCY.md's original A-numbered table (order_items/kots had NO anon
  // policy at all before this slice), same "new phase, new capability, own
  // test pair" shape as every prior phase's additions below.
  //
  // Honesty note (T6 has no order_items/kots by design — see the seed
  // script's own "no KOT/bill, just enough for A11" comment): the "0 rows"
  // half below would pass even with a broken `using (true)` policy, since
  // there is nothing at T6 TO leak. The positive-control half is what
  // actually exercises the policy's join condition against real data
  // (T5's full order/KOT narrative) — the pair together is the same shape
  // as A11/A11b, just without an equally strong negative case available in
  // this fixture. Worth a real cross-table order_items/kots negative case
  // if the seed ever gives a second AMD table a populated order.
  test("guest at T5 reading order_items for T6's session returns 0 rows", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query(
        "select oi.* from order_items oi join orders o on o.id = oi.order_id where o.table_session_id = $1",
        [id.TABLE_SESSION_AMD_2],
      );
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("guest at T5 CAN read their own table's order_items (positive control)", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query(
        "select oi.* from order_items oi join orders o on o.id = oi.order_id where o.table_session_id = $1",
        [id.TABLE_SESSION_AMD_1],
      );
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  test("guest at T5 reading kots for T6's session returns 0 rows", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query("select * from kots where table_session_id = $1", [id.TABLE_SESSION_AMD_2]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("guest at T5 CAN read their own table's kots (positive control)", async () => {
    const rows = await asGuest(client, id.GUEST_SESSION_AMD_T1, async (c) => {
      const r = await c.query("select * from kots where table_session_id = $1", [id.TABLE_SESSION_AMD_1]);
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});

// Token replay/expiry is an APPLICATION-layer check (ADR-0008): Postgres
// RLS has no way to know a token was "replayed" — it only sees whatever
// claims arrive after a guest_sessions row already exists. The PURE
// decision rule (packages/domain/src/qrToken.ts's evaluateGuestTokenAccess)
// is exhaustively branch-tested in isolation there — packages/db
// deliberately does NOT depend on packages/domain (they target different
// module-resolution modes: domain ships raw source for Next's bundler,
// db compiles to a real dist for Node — mixing them broke exactly this way
// once before, per PROGRESS.md's Phase 3a note on domain's resolution
// mode). So THIS suite's job is the other half of A14's proof: that the
// real values evaluateGuestTokenAccess would be fed — not_found,
// revoked_at, rotates_at, an open table_session — actually round-trip
// correctly through real Postgres via the real
// packages/db/src/guestToken.ts functions. The full wiring (both packages
// together, feeding real DB values into the real decision function) is
// exercised by apps/booth/app/t/[token]/route.ts directly — a bundler-mode
// Next app, like apps/pos, which is exactly where domain is meant to be
// consumed from.
describe("A14: expired/replayed QR token — the real data the token-layer gate decides on", () => {
  test("A14a: an unknown token hash resolves to no row — not_found", async () => {
    const tokenRow = await lookupTokenByHash(db, hashToken("this-token-was-never-minted"));
    expect(tokenRow).toBeNull();
  });

  test("A14b: a revoked token's revoked_at persists and is readable back — revoked", async () => {
    const minted = await mintTableToken(db, { outletId: id.OUTLET_AMD, tableId: id.TABLE_AMD_2 });
    await db.update(schema.qrTokens).set({ revokedAt: new Date() }).where(eq(schema.qrTokens.id, minted.id));

    const tokenRow = await lookupTokenByHash(db, hashToken(minted.rawToken));
    expect(tokenRow).not.toBeNull();
    expect(tokenRow?.revokedAt).not.toBeNull();
  });

  test("A14c: a token minted with a past rotation window reads back as already expired", async () => {
    const minted = await mintTableToken(db, { outletId: id.OUTLET_AMD, tableId: id.TABLE_AMD_2, rotationDays: -1 });

    const tokenRow = await lookupTokenByHash(db, hashToken(minted.rawToken));
    expect(tokenRow).not.toBeNull();
    expect(tokenRow!.rotatesAt.getTime()).toBeLessThan(Date.now());
  });

  test("A14d: a fresh token is neither revoked nor expired, and its table has no open session — the screenshot-from-home case", async () => {
    // T1/T2 (TABLE_AMD_1/2) both have open sessions in this fixture; find
    // one of AMD's other seeded tables (T3-T8) that has none.
    const unseated = await client.query<{ id: string }>(
      `select t.id from tables t
       where t.outlet_id = $1
         and not exists (
           select 1 from table_session_tables tst
           join table_sessions ts on ts.id = tst.table_session_id
           where tst.table_id = t.id and ts.status not in ('closed','abandoned','merged_into')
         )
       limit 1`,
      [id.OUTLET_AMD],
    );
    expect(unseated.rows).toHaveLength(1);

    const minted = await mintTableToken(db, { outletId: id.OUTLET_AMD, tableId: unseated.rows[0]!.id });
    const tokenRow = await lookupTokenByHash(db, hashToken(minted.rawToken));
    expect(tokenRow).not.toBeNull();
    expect(tokenRow?.revokedAt).toBeNull();
    expect(tokenRow!.rotatesAt.getTime()).toBeGreaterThan(Date.now());

    const openSession = await client.query(
      `select ts.id from table_session_tables tst
       join table_sessions ts on ts.id = tst.table_session_id
       where tst.table_id = $1 and ts.status not in ('closed','abandoned','merged_into')`,
      [unseated.rows[0]!.id],
    );
    expect(openSession.rows).toHaveLength(0);
  });

  test("A14e: a fresh token for T2 (which HAS an open session) round-trips clean — positive control", async () => {
    const minted = await mintTableToken(db, { outletId: id.OUTLET_AMD, tableId: id.TABLE_AMD_2 });
    const tokenRow = await lookupTokenByHash(db, hashToken(minted.rawToken));
    expect(tokenRow).not.toBeNull();
    expect(tokenRow?.revokedAt).toBeNull();
    expect(tokenRow!.rotatesAt.getTime()).toBeGreaterThan(Date.now());

    const openSession = await client.query(
      `select ts.id from table_session_tables tst
       join table_sessions ts on ts.id = tst.table_session_id
       where tst.table_id = $1 and ts.status not in ('closed','abandoned','merged_into')`,
      [id.TABLE_AMD_2],
    );
    expect(openSession.rows.length).toBeGreaterThan(0);
  });
});

test("A15: accessible_outlet_ids() takes no argument — cannot be used as a lookup oracle", async () => {
  // The function is defined with zero parameters specifically so it can
  // only ever resolve the CALLING session's own auth.uid() — there is no
  // overload that accepts a user id, so this must fail at the SQL level,
  // not return another user's data.
  await asUser(client, id.USER_AMD_CASHIER, async (c) => {
    await expect(c.query("select accessible_outlet_ids($1)", [id.USER_ORG1_OWNER])).rejects.toThrow();
  });
});

// =============================================================================
// Phase 3a additions — TENANCY.md §4's capability matrix, "Take an order"
// and "Void a fired KOT item" rows, plus DOMAIN.md §3.1's cross-store merge
// guard. Same capability-vs-scope shape as A6/A9 (drizzle/0012), enforced by
// drizzle/0014_ordering_capability.sql. A7 itself stays skipped (see the
// header comment) — these are its siblings, not its resolution.
// =============================================================================

describe("Phase 3a — 'take an order' is a role capability (TENANCY.md §4)", () => {
  const attemptOrderInsert = (c: pg.Client) =>
    c.query(
      "insert into orders (id, business_date, outlet_id, store_id, business_day_id, status, idempotency_key) values (gen_random_uuid(), current_date, $1, $2, $3, 'open', gen_random_uuid())",
      [id.OUTLET_AMD, id.STORE_AMD_A, id.BIZDAY_AMD],
    );

  test("kitchen cannot take an order", async () => {
    await asUser(client, id.USER_AMD_KITCHEN, async (c) => {
      await expect(attemptOrderInsert(c)).rejects.toThrow(/row-level security/);
    });
  });

  test("brand_manager cannot take an order (they manage the menu, not the floor)", async () => {
    await asUser(client, id.USER_BRANDA_MGR, async (c) => {
      await expect(attemptOrderInsert(c)).rejects.toThrow(/row-level security/);
    });
  });

  test("cashier CAN take an order (positive control)", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const r = await attemptOrderInsert(c);
      expect(r.rowCount).toBe(1);
    });
  });

  test("captain CAN take an order (positive control)", async () => {
    await asUser(client, id.USER_AMD_CAPTAIN, async (c) => {
      const r = await attemptOrderInsert(c);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("Phase 3a — a post-fire void requires manager auth (DOMAIN.md §3.2)", () => {
  // A pre-fire (pending) item voids for free; a post-fire void needs
  // org_owner / cluster_manager / outlet_manager — never cashier, never
  // captain (TENANCY.md §4: "Void a fired KOT item"). authorized_by is
  // stamped server-side by the trigger from auth.uid(), never trusted from
  // the client — these inserts don't set it.
  const attemptPostFireVoid = (c: pg.Client, orderItemId: string) =>
    c.query(
      `insert into order_item_voids
         (id, business_date, order_item_id, outlet_id, store_id, quantity_voided, reason_code, requires_auth, voided_by)
       values (gen_random_uuid(), current_date, $1, $2, $3, 1, 'staff_error', true, gen_random_uuid())`,
      [orderItemId, id.OUTLET_AMD, id.STORE_AMD_A],
    );

  async function aFiredOrderItemId(c: pg.Client): Promise<string> {
    const r = await c.query("select id from order_items where order_id = $1 limit 1", [id.ORDER_AMD_1]);
    return r.rows[0].id as string;
  }

  test("cashier cannot authorize a post-fire void", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const itemId = await aFiredOrderItemId(c);
      await expect(attemptPostFireVoid(c, itemId)).rejects.toThrow(/insufficient privilege/);
    });
  });

  test("captain cannot authorize a post-fire void", async () => {
    await asUser(client, id.USER_AMD_CAPTAIN, async (c) => {
      const itemId = await aFiredOrderItemId(c);
      await expect(attemptPostFireVoid(c, itemId)).rejects.toThrow(/insufficient privilege/);
    });
  });

  test("outlet_manager CAN authorize a post-fire void (positive control)", async () => {
    await asUser(client, id.USER_AMD_MGR, async (c) => {
      const itemId = await aFiredOrderItemId(c);
      const r = await attemptPostFireVoid(c, itemId);
      expect(r.rowCount).toBe(1);
    });
  });

  test("a pre-fire (pending) void needs no auth, for anyone who can take an order", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      // A cashier can insert a pending item (the "take an order" capability
      // above) and free-void it in the same transaction — nothing here
      // should touch can_authorize_void() at all, since requires_auth=false.
      const menuItem = await c.query("select id, tax_class_id from menu_items where brand_id = $1 limit 1", [
        id.BRAND_A,
      ]);
      const pending = await c.query(
        `insert into order_items
           (id, business_date, order_id, outlet_id, store_id, menu_item_id, quantity, unit_price_paise, tax_class_id, status, client_line_id, idempotency_key)
         values (gen_random_uuid(), current_date, $1, $2, $3, $4, 1, 10000, $5, 'pending', gen_random_uuid(), gen_random_uuid())
         returning id`,
        [id.ORDER_AMD_1, id.OUTLET_AMD, id.STORE_AMD_A, menuItem.rows[0].id, menuItem.rows[0].tax_class_id],
      );
      const r = await c.query(
        `insert into order_item_voids
           (id, business_date, order_item_id, outlet_id, store_id, quantity_voided, reason_code, requires_auth, voided_by)
         values (gen_random_uuid(), current_date, $1, $2, $3, 1, 'guest_changed_mind', false, gen_random_uuid())`,
        [pending.rows[0].id, id.OUTLET_AMD, id.STORE_AMD_A],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("Phase 3a — a table_session merge is blocked across stores (DOMAIN.md §3.1)", () => {
  // Surat is the shared cloud kitchen (TENANCY.md's A8 case): Brand A and
  // Brand B both operate out of the same physical outlet but are different
  // stores. Folding one brand's session into the other's would mix two
  // brands' orders into one eventual bill — exactly what the trigger exists
  // to prevent, and outlet-scoping alone would NOT catch it.
  test("merging a Surat Brand A session into a Surat Brand B session is rejected", async () => {
    await asUser(client, id.USER_SURAT_MGR, async (c) => {
      const a = await c.query(
        `insert into table_sessions (id, outlet_id, store_id, business_day_id, status, idempotency_key)
         values (gen_random_uuid(), $1, $2, $3, 'open', gen_random_uuid()) returning id`,
        [id.OUTLET_SURAT, id.STORE_SURAT_A, id.BIZDAY_SURAT],
      );
      const b = await c.query(
        `insert into table_sessions (id, outlet_id, store_id, business_day_id, status, idempotency_key)
         values (gen_random_uuid(), $1, $2, $3, 'open', gen_random_uuid()) returning id`,
        [id.OUTLET_SURAT, id.STORE_SURAT_B, id.BIZDAY_SURAT],
      );
      await expect(
        c.query("update table_sessions set status = 'merged_into', merged_into_session_id = $1 where id = $2", [
          b.rows[0].id,
          a.rows[0].id,
        ]),
      ).rejects.toThrow(/different stores/);
    });
  });

  test("merging two same-store sessions succeeds (positive control)", async () => {
    await asUser(client, id.USER_SURAT_MGR, async (c) => {
      const a = await c.query(
        `insert into table_sessions (id, outlet_id, store_id, business_day_id, status, idempotency_key)
         values (gen_random_uuid(), $1, $2, $3, 'open', gen_random_uuid()) returning id`,
        [id.OUTLET_SURAT, id.STORE_SURAT_A, id.BIZDAY_SURAT],
      );
      const b = await c.query(
        `insert into table_sessions (id, outlet_id, store_id, business_day_id, status, idempotency_key)
         values (gen_random_uuid(), $1, $2, $3, 'open', gen_random_uuid()) returning id`,
        [id.OUTLET_SURAT, id.STORE_SURAT_A, id.BIZDAY_SURAT],
      );
      const r = await c.query(
        "update table_sessions set status = 'merged_into', merged_into_session_id = $1 where id = $2",
        [b.rows[0].id, a.rows[0].id],
      );
      expect(r.rowCount).toBe(1);
    });
  });
});

// =============================================================================
// Phase 3b additions — TENANCY.md §4's "Day open/day close" and "Void/
// refund a settled bill" rows (manager-only, cashier excluded), and the
// discount-threshold split on "Apply discount <= / > threshold". Enforced
// by drizzle/0016_billing_capability_and_allocator.sql.
// =============================================================================

describe("Phase 3b — day open/close is manager-only (TENANCY.md §4)", () => {
  const attemptDayInsert = (c: pg.Client) =>
    // A distinct future business_date + status='closed' sidesteps the
    // "one open day per outlet" partial unique index — this test is only
    // about the CAPABILITY gate, not day-lifecycle correctness.
    c.query(
      "insert into business_days (id, outlet_id, business_date, status) values (gen_random_uuid(), $1, '2099-01-01', 'closed')",
      [id.OUTLET_AMD],
    );

  test("cashier cannot open/create a business day", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      await expect(attemptDayInsert(c)).rejects.toThrow(/row-level security/);
    });
  });

  test("outlet_manager CAN open/create a business day (positive control)", async () => {
    await asUser(client, id.USER_AMD_MGR, async (c) => {
      const r = await attemptDayInsert(c);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("Phase 3b — void/refund a settled bill is manager-only (TENANCY.md §4)", () => {
  test("cashier cannot void a settled bill", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      // No explicit WITH CHECK was written in the policy — Postgres reuses
      // the single USING clause for both row-selection (against the OLD
      // row) AND the write-check (against the NEW row) when only one is
      // given. The OLD row (status='settled') passes the USING/visibility
      // half either way; it's the NEW row (status='voided') failing the
      // reused WITH CHECK half that raises here, not a silent 0-row filter.
      await expect(c.query("update bills set status = 'voided' where id = $1", [id.BILL_AMD_1])).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  test("outlet_manager CAN void a settled bill (positive control)", async () => {
    await asUser(client, id.USER_AMD_MGR, async (c) => {
      const r = await c.query("update bills set status = 'voided' where id = $1", [id.BILL_AMD_1]);
      expect(r.rowCount).toBe(1);
    });
  });
});

describe("Phase 3b — a discount above the threshold needs a manager (TENANCY.md §4)", () => {
  const attemptBillWithDiscount = (c: pg.Client, discountPaise: number) =>
    c.query(
      `insert into bills
         (id, business_date, outlet_id, store_id, gst_registration_id, terminal_id, status,
          subtotal_paise, discount_paise, payable_paise, idempotency_key)
       values (gen_random_uuid(), current_date, $1, $2, $3, $4, 'draft', 10000, $5, ${10000 - discountPaise}, gen_random_uuid())`,
      [id.OUTLET_AMD, id.STORE_AMD_A, id.GST_GJ, id.TERMINAL_AMD_T1, discountPaise],
    );

  test("cashier CAN apply a discount at exactly the 20% threshold (positive control)", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      const r = await attemptBillWithDiscount(c, 2000); // exactly 20% of 10 000
      expect(r.rowCount).toBe(1);
    });
  });

  test("cashier cannot apply a discount above the 20% threshold", async () => {
    await asUser(client, id.USER_AMD_CASHIER, async (c) => {
      await expect(attemptBillWithDiscount(c, 2001)).rejects.toThrow(/insufficient privilege/);
    });
  });

  test("outlet_manager CAN apply a discount above the threshold (positive control)", async () => {
    await asUser(client, id.USER_AMD_MGR, async (c) => {
      const r = await attemptBillWithDiscount(c, 5000); // 50% — well above threshold
      expect(r.rowCount).toBe(1);
    });
  });
});
