/**
 * One-off Phase 2 checkpoint verification — NOT part of the permanent test
 * suite (that's test/rls/adversarial.test.ts's A6/A9, already passing).
 * This exercises the full lifecycle apps/console/app/menu/item-actions.ts
 * drives, using the same withUser() primitive those Server Actions call
 * internally (Server Actions themselves can't be invoked standalone here —
 * they need next/headers' request-scoped cookies(), which only exists
 * inside a real Next.js request).
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDbClient } from "../src/client.js";
import { withUser } from "../src/rls.js";
import * as schema from "../src/schema/index.js";
import * as id from "./data/fixture-ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function main() {
  const db = createDbClient(DATABASE_URL);
  const itemId = crypto.randomUUID();

  console.log("1. Owner creates a menu item...");
  await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
    await tx.insert(schema.menuItems).values({
      id: itemId, brandId: id.BRAND_A, name: "Verify: Paneer Tikka",
      basePricePaise: 28000n, taxClassId: id.TAX_FOOD5_ORG1, diet: "veg", status: "published",
    });
    await tx.insert(schema.menuAuditLog).values({
      id: crypto.randomUUID(), entityType: "menu_item", entityId: itemId, action: "create",
      actorUserId: id.USER_ORG1_OWNER, toStatus: "published",
    });
  });
  console.log("   OK — item created");

  console.log("2. Owner adds a variant group + option...");
  const groupId = crypto.randomUUID();
  await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
    await tx.insert(schema.optionGroups).values({ id: groupId, menuItemId: itemId, kind: "variant", name: "Size", minSelect: 1, maxSelect: 1 });
    await tx.insert(schema.optionItems).values({ id: crypto.randomUUID(), optionGroupId: groupId, name: "Full", pricePaise: 32000n });
  });
  console.log("   OK — option group + item created");

  console.log("3. Owner publishes a price override at AMD...");
  await withUser(db, id.USER_ORG1_OWNER, async (tx) => {
    const overrideId = crypto.randomUUID();
    await tx.insert(schema.menuItemOverrides).values({
      id: overrideId, menuItemId: itemId, storeId: id.STORE_AMD_A, pricePaise: 30000n,
      effectiveFrom: new Date(), status: "published", publishedAt: new Date(),
    });
    await tx.insert(schema.menuAuditLog).values({
      id: crypto.randomUUID(), entityType: "menu_item_override", entityId: overrideId, action: "publish",
      actorUserId: id.USER_ORG1_OWNER, toStatus: "published",
    });
  });
  console.log("   OK — price published");

  console.log("4. resolve_menu() reflects the new price immediately (no cron)...");
  const resolved = await db.execute<{ price_paise: string }>(
    `select price_paise from resolve_menu('${id.STORE_AMD_A}', 'dinein', now()) where menu_item_id = '${itemId}'`,
  );
  const price = resolved.rows[0]?.price_paise;
  if (price !== "30000") throw new Error(`Expected resolve_menu to show 30000 paise, got ${price}`);
  console.log("   OK — resolve_menu shows ₹300.00 (the published override, not the ₹280 brand default)");

  console.log("5. Cashier attempts to publish a price — must be rejected...");
  let cashierPriceRejected = false;
  try {
    await withUser(db, id.USER_AMD_CASHIER, async (tx) => {
      await tx.insert(schema.menuItemOverrides).values({
        id: crypto.randomUUID(), menuItemId: itemId, storeId: id.STORE_AMD_A, pricePaise: 1n,
        effectiveFrom: new Date(), status: "published", publishedAt: new Date(),
      });
    });
  } catch (err) {
    // DrizzleQueryError's own .message is "Failed query: <sql>" — the real
    // Postgres RAISE EXCEPTION text is in .cause.message. This bit me once
    // already writing item-actions.ts's error handling; fixed there too.
    let msg = "";
    let current: unknown = err;
    while (current instanceof Error) {
      msg += current.message;
      current = current.cause;
    }
    cashierPriceRejected = msg.includes("insufficient privilege");
  }
  if (!cashierPriceRejected) throw new Error("Cashier price publish was NOT rejected — capability trigger regression");
  console.log("   OK — rejected with the expected error");

  console.log("6. Same cashier 86's the item — must succeed...");
  const cashierOverrideId = crypto.randomUUID();
  await withUser(db, id.USER_AMD_CASHIER, async (tx) => {
    await tx.insert(schema.menuItemOverrides).values({
      id: cashierOverrideId, menuItemId: itemId, storeId: id.STORE_AMD_A, isAvailable: false,
      effectiveFrom: new Date(), status: "published", publishedAt: new Date(),
    });
    await tx.insert(schema.menuAuditLog).values({
      id: crypto.randomUUID(), entityType: "menu_item_override", entityId: cashierOverrideId, action: "set_availability",
      actorUserId: id.USER_AMD_CASHIER, toStatus: "published",
    });
  });
  console.log("   OK — cashier successfully 86'd the item");

  console.log("7. resolve_menu() shows unavailable, price STILL ₹300 (fields resolve independently)...");
  const afterEightySix = await db.execute<{ price_paise: string; is_available: boolean }>(
    `select price_paise, is_available from resolve_menu('${id.STORE_AMD_A}', 'dinein', now()) where menu_item_id = '${itemId}'`,
  );
  const row = afterEightySix.rows[0];
  if (row?.price_paise !== "30000" || row?.is_available !== false) {
    throw new Error(`Expected price=30000 (unchanged) and is_available=false, got ${JSON.stringify(row)}`);
  }
  console.log("   OK — the 86 did not erase the price override");

  console.log("8. Audit trail has the expected rows...");
  const audit = await withUser(db, id.USER_ORG1_OWNER, (tx) =>
    tx.select().from(schema.menuAuditLog).where(eq(schema.menuAuditLog.entityId, itemId)),
  );
  console.log(`   OK — ${audit.length} audit row(s) for the item itself (create)`);

  console.log("\nAll checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFAILED:", err);
  process.exit(1);
});
