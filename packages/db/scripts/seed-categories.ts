/**
 * Dev convenience: gives the seeded Brand A menu some categories, so
 * /menu's grouped-by-category UI has real structure to render instead of
 * one giant "Uncategorised" pile.
 *
 * Separate from seed-believable-chain.ts on purpose — categories are a
 * Phase 2 concept and the believable-chain seed is the fixture the RLS and
 * override suites are written against; adding rows to it would change what
 * those tests see. Idempotent.
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

// Deliberately NOT process.env.DATABASE_URL: the root .env points that at
// the docker-compose instance (54329), which is the schema-dev/bench
// database — not the Supabase-local stack (54322) that the app and its
// real auth users actually live on. Reading DATABASE_URL here would make
// this script silently seed the wrong database and then report "no
// org_owner found", which is exactly what it did the first time.
// seed-auth-users.ts sidesteps the same trap with the same env var.
const DATABASE_URL =
  process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Keyword → category. Anything unmatched stays uncategorised, which is
// itself worth seeing in the UI.
const RULES: { name: string; sortOrder: number; match: RegExp }[] = [
  { name: "Starters", sortOrder: 1, match: /tikka|kebab|pakora|samosa|chaat|papad|soup|salad|65|manchur/i },
  { name: "Mains", sortOrder: 2, match: /curry|masala|butter|korma|handi|kadai|paneer|chicken|mutton|fish|dal|kofta|biryani|pulao/i },
  { name: "Breads & Rice", sortOrder: 3, match: /naan|roti|paratha|kulcha|rice|bread/i },
  { name: "Desserts", sortOrder: 4, match: /halwa|kulfi|gulab|jamun|rasmalai|kheer|ice cream|brownie/i },
  { name: "Beverages", sortOrder: 5, match: /lassi|chai|coffee|juice|soda|water|cola|mojito|shake|tea/i },
];

/**
 * Resolve a privileged user by ROLE rather than hardcoding a fixture id.
 * seed-auth-users.ts repoints USER_ORG1_OWNER's membership at a real
 * GoTrue uuid, so the fixture constant stops having a membership the
 * moment anyone runs `pnpm seed:auth` — a hardcoded id then silently fails
 * RLS (the row just isn't visible) rather than erroring usefully. Asking
 * the database "who is an org_owner right now" works either way.
 */
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
    const existing = await tx.select().from(schema.categories).where(eq(schema.categories.brandId, id.BRAND_A));
    let categories = existing;

    if (existing.length === 0) {
      const rows = RULES.map((r) => ({
        id: crypto.randomUUID(),
        brandId: id.BRAND_A,
        name: r.name,
        sortOrder: r.sortOrder,
      }));
      await tx.insert(schema.categories).values(rows);
      categories = rows;
      console.log(`Created ${rows.length} categories for Brand A.`);
    } else {
      console.log(`${existing.length} categories already exist — reusing them.`);
    }

    const items = await tx
      .select({ id: schema.menuItems.id, name: schema.menuItems.name, categoryId: schema.menuItems.categoryId })
      .from(schema.menuItems)
      .where(eq(schema.menuItems.brandId, id.BRAND_A));

    let assigned = 0;
    for (const item of items) {
      if (item.categoryId) continue;
      const rule = RULES.find((r) => r.match.test(item.name));
      if (!rule) continue;
      const category = categories.find((c) => c.name === rule.name);
      if (!category) continue;
      await tx.update(schema.menuItems).set({ categoryId: category.id }).where(eq(schema.menuItems.id, item.id));
      assigned++;
    }
    console.log(`Assigned ${assigned} of ${items.length} Brand A items to a category.`);
  });

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
