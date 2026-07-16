/**
 * The 15-case RLS adversarial suite, transcribed verbatim from
 * docs/TENANCY.md §6. Every case must DENY (return 0 rows / 0 affected /
 * reject), except A12 which is a positive case (anon reads published
 * menu items). Runs against the Supabase local stack's real GoTrue-backed
 * auth.uid() — see fixtures.ts for why.
 *
 * A6, A7, A9, A14 are ROLE-CAPABILITY or token-layer concerns, not tenant-
 * scope ones. Phase 1 deliberately enforced tenant ISOLATION only and left
 * the CAPABILITY matrix for Phase 2/3a. A6 and A9 are built (Phase 2's
 * menu-capability migration, drizzle/0012_menu_capability.sql) and
 * un-skipped below.
 *
 * A7 ("captain cannot create a BILL") is still correctly `test.skip` —
 * bills are Phase 3b (Billing) work; Phase 3a only writes orders/order_
 * items/kots. Do not un-skip A7 against an orders-table insert — that
 * would be testing a different rule than the one TENANCY.md names. The
 * order/order_item/kot capability equivalents A7 is adjacent to (§4's
 * "take an order" and "void a fired KOT item" rows) are covered below as
 * Phase 3a additions, same shape as A6/A9 but not literally A7.
 *
 * A14 (QR token replay) still legitimately `test.skip` — no token-minting
 * code path exists yet (Phase 5, Booth).
 */
import { beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import * as id from "../../scripts/data/fixture-ids.js";
import { asGuest, asUser, makeClient } from "./fixtures.js";

let client: pg.Client;

beforeAll(async () => {
  client = makeClient();
  await client.connect();
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

// "captain inserts a bill" is a role-capability question, same shape as
// A6/A9 — but no bill-creation code path exists yet (that's Phase 3b's
// billing work, ROADMAP.md §3), so there is nothing to enforce a rule
// against. Phase 3a's own order/order_item/kot capability rules (the "take
// an order" and "void a fired KOT item" rows of TENANCY.md §4) are covered
// below — they are A7's siblings, not a resolution of A7 itself.
test.skip("A7: captain cannot create a bill (capability, not scope) — Phase 3b work, not yet enforced", () => {});

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
});

// Token replay/expiry is an APPLICATION-layer check (the Edge Function
// that mints a guest's scoped JWT validates qr_tokens.rotates_at /
// revoked_at BEFORE issuing a token) — Postgres RLS has no way to know a
// token was "replayed"; it only sees whatever claims arrive in a valid
// JWT. That minting flow is Phase 5 (Booth) work and doesn't exist yet.
test.skip("A14: expired/replayed QR token denied at token layer — Phase 5 work, not yet built", () => {});

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
