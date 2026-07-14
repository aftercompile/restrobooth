/**
 * The 15-case RLS adversarial suite, transcribed verbatim from
 * docs/TENANCY.md §6. Every case must DENY (return 0 rows / 0 affected /
 * reject), except A12 which is a positive case (anon reads published
 * menu items). Runs against the Supabase local stack's real GoTrue-backed
 * auth.uid() — see fixtures.ts for why.
 *
 * A6, A7, A9, A14 are ROLE-CAPABILITY or token-layer concerns, not tenant-
 * scope ones. Phase 1 deliberately enforced tenant ISOLATION only and left
 * the CAPABILITY matrix for Phase 2. A6 and A9 are now built (Phase 2's
 * menu-capability migration, drizzle/0012_menu_capability.sql) and
 * un-skipped below. A7 (captain can't create a bill) and A14 (QR token
 * replay) still legitimately `test.skip` — no bill-creation or
 * token-minting code path exists yet to enforce a rule against.
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
// A6/A9 — but no bill-creation code path exists yet (that's Phase 3a's
// ordering/billing work), so there is nothing to enforce a rule against.
test.skip("A7: captain cannot create a bill (capability, not scope) — Phase 3a work, not yet enforced", () => {});

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
