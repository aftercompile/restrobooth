/**
 * Dev convenience: every seeded menu_items row defaulted to 'hot' when
 * migration 0013 added the column, so the floor's KOT routing (Phase 3a)
 * would fire every single ticket to one line. Gives the seeded Brand A menu
 * a believable hot/cold/bar split so "curry + dessert fires as two KOTs" is
 * something you can actually see in dev, not just in a unit test.
 *
 * Same shape as seed-categories.ts on purpose — separate from
 * seed-believable-chain.ts so the RLS/override fixture stays untouched,
 * idempotent, resolves the acting user by role rather than a hardcoded id.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { createDbClient } from "../src/client.js";
import { withUser } from "../src/rls.js";
import * as schema from "../src/schema/index.js";
import * as id from "./data/fixture-ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

// See seed-categories.ts's identical comment: SEED_DATABASE_URL, never
// DATABASE_URL, or this silently seeds the docker-compose bench DB instead
// of the Supabase-local stack the app and its real auth users live on.
const DATABASE_URL = process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Keyword → section. Unmatched items keep the column default ('hot') —
// itself the right fallback (DOMAIN.md §3.3: an unclassified item still
// prints somewhere a human sees it, rather than vanishing).
const RULES: { section: "hot" | "cold" | "bar"; match: RegExp }[] = [
  { section: "bar", match: /lassi|chai|coffee|juice|soda|water|cola|mojito|shake|tea|beer|wine/i },
  { section: "cold", match: /halwa|kulfi|gulab|jamun|rasmalai|kheer|ice cream|brownie|salad/i },
  // Everything else (starters, mains, breads & rice) stays 'hot' — the default.
];

async function findOrgOwner(db: ReturnType<typeof createDbClient>): Promise<string> {
  const rows = await db
    .select({ userId: schema.memberships.userId })
    .from(schema.memberships)
    .innerJoin(schema.brands, eq(schema.brands.orgId, schema.memberships.scopeId))
    .where(
      and(
        eq(schema.brands.id, id.BRAND_A),
        eq(schema.memberships.scopeType, "org"),
        eq(schema.memberships.role, "org_owner"),
      ),
    );
  const owner = rows[0];
  if (!owner) throw new Error("No org_owner membership found for Brand A's org — run `pnpm seed` first.");
  return owner.userId;
}

async function main() {
  const db = createDbClient(DATABASE_URL);
  const ownerId = await findOrgOwner(db);
  console.log(`Acting as org owner ${ownerId}`);

  await withUser(db, ownerId, async (tx) => {
    const items = await tx
      .select({ id: schema.menuItems.id, name: schema.menuItems.name })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.brandId, id.BRAND_A));

    const updated = { hot: 0, cold: 0, bar: 0 };
    for (const item of items) {
      const rule = RULES.find((r) => r.match.test(item.name));
      if (!rule) continue; // stays 'hot', the column default
      await tx.update(schema.menuItems).set({ kitchenSection: rule.section }).where(eq(schema.menuItems.id, item.id));
      updated[rule.section]++;
    }
    console.log(`Routed ${updated.cold} items to cold, ${updated.bar} to bar; the rest stay hot (${items.length} total).`);
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
