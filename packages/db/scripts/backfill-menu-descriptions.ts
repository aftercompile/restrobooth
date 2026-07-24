/**
 * `pnpm --filter @restrobooth/db backfill:menu-descriptions` — Booth
 * redesign Pass 1. Backfills `menu_items.description` for Ember & Oak's
 * 12 seeded items — a real column that's existed since the base schema
 * but was never populated by `import-steakhouse.ts` (the source export
 * had no description field to begin with). Hand-written, one line per
 * dish, matched by exact name — same additive/idempotent shape as
 * `backfill-menu-tags.ts` (only UPDATEs existing rows, logs any
 * unmatched name rather than guessing).
 *
 * Scoped to Ember & Oak only (the live fixture) — the believable-chain
 * fixture's ~120 items are untouched, out of scope for this pass.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDbClient, type Database } from "../src/client.js";
import * as schema from "../src/schema/index.js";

const DESCRIPTIONS: Record<string, string> = {
  "Bourbon BBQ Burger": "Hand-pressed beef patty, smoky bourbon glaze, melted cheddar, toasted brioche bun.",
  "Truffle Fries": "Hand-cut fries tossed in truffle oil and shaved parmesan.",
  "Grilled Asparagus": "Char-grilled asparagus spears finished with lemon and sea salt.",
  "Mashed Potatoes": "Creamy Yukon gold potatoes, whipped with butter and cream.",
  "Caesar Salad": "Crisp romaine, shaved parmesan, garlic croutons, classic dressing.",
  "Prawn Cocktail": "Chilled prawns, tangy cocktail sauce, a squeeze of lemon.",
  "Filet Mignon": "Center-cut tenderloin, grilled to your liking, finished with herb butter.",
  "New York Strip": "A well-marbled cut, char-grilled for a deep, smoky crust.",
  "Ribeye Steak": "Richly marbled ribeye, grilled over an open flame.",
  "Chocolate Lava Cake": "Warm dark chocolate cake with a molten center, served with vanilla ice cream.",
  "Cabernet Sauvignon": "A full-bodied red with notes of blackcurrant and oak.",
  "Old Fashioned": "Bourbon, bitters, and a twist of orange, stirred over ice.",
};

async function backfillMenuDescriptions(db: Database): Promise<void> {
  const names = Object.keys(DESCRIPTIONS);
  const rows = await db.select({ id: schema.menuItems.id, name: schema.menuItems.name }).from(schema.menuItems);

  const matchedNames = new Set<string>();
  for (const row of rows) {
    const description = DESCRIPTIONS[row.name];
    if (!description) continue;
    matchedNames.add(row.name);
    await db.update(schema.menuItems).set({ description }).where(eq(schema.menuItems.id, row.id));
  }

  console.log(`Backfilled descriptions for ${matchedNames.size}/${names.length} items.`);
  for (const name of names) {
    if (!matchedNames.has(name)) console.log(`  unmatched: ${name}`);
  }
}

async function cliMain() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(here, "../../../.env") });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
  await backfillMenuDescriptions(createDbClient(url));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cliMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { backfillMenuDescriptions };
