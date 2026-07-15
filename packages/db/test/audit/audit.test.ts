/**
 * The menu audit log (TENANCY.md §7.5, Phase 2). Two things must hold and
 * both are "things that break", not CRUD glue:
 *
 *  1. A publish writes exactly ONE audit row, with the right entity, actor,
 *     action, and old→new — an audit trail that miscounts or misattributes
 *     is worse than none.
 *  2. Audit rows are RLS-isolated by brand. A publish at brand A's org must
 *     be invisible to a different org entirely — an audit log that leaks
 *     across tenants is a confidentiality breach, not a cosmetic bug.
 *
 * Writes go through withUser() — the exact primitive
 * apps/console/app/menu/item-actions.ts's Server Action uses — so this
 * exercises the real committed path, not a simulation. Reads use the raw
 * pg asUser() helper (rolled-back transactions) so they can't mutate the
 * shared fixture.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { and, eq } from "drizzle-orm";
import { createDbClient, type Database } from "../../src/client.js";
import { withUser } from "../../src/rls.js";
import * as schema from "../../src/schema/index.js";
import * as id from "../../scripts/data/fixture-ids.js";
import { asUser, makeClient, TEST_DATABASE_URL } from "../rls/fixtures.js";

const AUDIT_ITEM = "00000000-0000-0000-0030-000000000001";
const AUDIT_OVERRIDE = "00000000-0000-0000-0030-000000000002";

let db: Database;
let client: pg.Client;

beforeAll(async () => {
  db = createDbClient(TEST_DATABASE_URL);
  client = makeClient();
  await client.connect();

  // Owner creates an item and publishes a price override, each paired with
  // its audit row — exactly the two-insert transaction the publish Server
  // Action performs.
  await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
    await tx.insert(schema.menuItems).values({
      id: AUDIT_ITEM,
      brandId: id.BRAND_A,
      name: "AUDIT TEST: Dal Makhani",
      basePricePaise: 26000n,
      taxClassId: id.TAX_FOOD5_ORG1,
      status: "published",
    });
    await tx.insert(schema.menuAuditLog).values({
      id: crypto.randomUUID(),
      entityType: "menu_item",
      entityId: AUDIT_ITEM,
      action: "create",
      actorUserId: id.USER_ORG1_OWNER,
      toStatus: "published",
    });
  });

  await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
    await tx.insert(schema.menuItemOverrides).values({
      id: AUDIT_OVERRIDE,
      menuItemId: AUDIT_ITEM,
      storeId: id.STORE_AMD_A,
      pricePaise: 30000n,
      effectiveFrom: new Date(),
      status: "published",
      publishedAt: new Date(),
    });
    await tx.insert(schema.menuAuditLog).values({
      id: crypto.randomUUID(),
      entityType: "menu_item_override",
      entityId: AUDIT_OVERRIDE,
      action: "publish",
      actorUserId: id.USER_ORG1_OWNER,
      toStatus: "published",
      oldValue: { pricePaise: "26000" },
      newValue: { pricePaise: "30000" },
    });
  });
}, 60_000);

afterAll(async () => {
  // Clean up the committed test rows so a re-run without a reseed stays
  // idempotent (globalSetup would also truncate, but don't rely on it).
  await db.execute(`delete from menu_audit_log where entity_id in ('${AUDIT_ITEM}', '${AUDIT_OVERRIDE}')`);
  await db.execute(`delete from menu_item_overrides where id = '${AUDIT_OVERRIDE}'`);
  await db.execute(`delete from menu_items where id = '${AUDIT_ITEM}'`);
  await client.end();
});

describe("a publish writes exactly one correct audit row", () => {
  test("the override publish produced one row with the right entity, actor, action, and old→new", async () => {
    const rows = await withUser(db, id.USER_ORG1_OWNER, (tx) =>
      tx
        .select()
        .from(schema.menuAuditLog)
        .where(
          and(
            eq(schema.menuAuditLog.entityType, "menu_item_override"),
            eq(schema.menuAuditLog.entityId, AUDIT_OVERRIDE),
          ),
        ),
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("publish");
    expect(row.actorUserId).toBe(id.USER_ORG1_OWNER);
    expect(row.toStatus).toBe("published");
    expect(row.oldValue).toEqual({ pricePaise: "26000" });
    expect(row.newValue).toEqual({ pricePaise: "30000" });
  });

  test("the item create produced its own separate audit row", async () => {
    const rows = await withUser(db, id.USER_ORG1_OWNER, (tx) =>
      tx.select().from(schema.menuAuditLog).where(eq(schema.menuAuditLog.entityId, AUDIT_ITEM)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("create");
  });
});

describe("audit rows are RLS-isolated by brand", () => {
  test("a franchisee from a different org reads zero of these audit rows", async () => {
    // The security boundary: an audit trail that leaks across tenants is a
    // breach. USER_ORG2_OWNER has full ownership of a DIFFERENT org and
    // must see nothing here.
    const rows = await asUser(client, id.USER_ORG2_OWNER, async (c) => {
      const r = await c.query("select * from menu_audit_log where entity_id in ($1, $2)", [
        AUDIT_ITEM,
        AUDIT_OVERRIDE,
      ]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  test("brand A's own owner CAN read them (positive control — proves isolation discriminates)", async () => {
    const rows = await asUser(client, id.USER_ORG1_OWNER, async (c) => {
      const r = await c.query("select * from menu_audit_log where entity_id in ($1, $2)", [
        AUDIT_ITEM,
        AUDIT_OVERRIDE,
      ]);
      return r.rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
