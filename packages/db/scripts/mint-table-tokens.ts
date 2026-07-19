/**
 * Provisions (or re-provisions) every table's printed QR token — the thing
 * that actually gets printed onto a table tent for the Booth to work at
 * all. Prints `${BOOTH_URL}/t/{rawToken}` per table; the raw token is
 * NEVER stored (mintTableToken hashes it before the insert), so this
 * output is the only place it ever exists in plaintext — save it or print
 * it now.
 *
 * Idempotent-by-rotation: re-running revokes each table's previous token
 * and mints a fresh one (mintTableToken's own contract) — old printed
 * tents stop working the moment you re-run this, which is correct
 * (booth.ts's `one_live_token_per_table` index enforces there is never
 * more than one live token per table regardless).
 *
 * Usage: pnpm --filter @restrobooth/db tokens:mint [outletCode]
 *   DATABASE_URL — which Postgres to mint against (local or the live cloud DB)
 *   BOOTH_URL    — defaults to http://localhost:3000 (the Booth's dev server)
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDbClient } from "../src/client.js";
import { mintTableToken } from "../src/guestToken.js";
import * as schema from "../src/schema/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
const BOOTH_URL = process.env.BOOTH_URL ?? "http://localhost:3000";

async function main() {
  const outletCodeFilter = process.argv[2];
  const db = createDbClient(DATABASE_URL!);

  const rows = await db
    .select({
      tableId: schema.tables.id,
      tableLabel: schema.tables.label,
      outletId: schema.outlets.id,
      outletName: schema.outlets.name,
      outletCode: schema.outlets.code,
    })
    .from(schema.tables)
    .innerJoin(schema.outlets, eq(schema.tables.outletId, schema.outlets.id))
    .where(outletCodeFilter ? eq(schema.outlets.code, outletCodeFilter) : undefined);

  if (rows.length === 0) {
    console.log(outletCodeFilter ? `No tables found for outlet code "${outletCodeFilter}".` : "No tables found.");
    return;
  }

  let currentOutlet: string | null = null;
  for (const row of rows) {
    if (row.outletName !== currentOutlet) {
      currentOutlet = row.outletName;
      console.log(`\n${row.outletName} (${row.outletCode}):`);
    }
    const { rawToken, rotatesAt } = await mintTableToken(db, { outletId: row.outletId, tableId: row.tableId });
    console.log(`  ${row.tableLabel}: ${BOOTH_URL}/t/${rawToken}  (rotates ${rotatesAt.toISOString().slice(0, 10)})`);
  }

  console.log(`\nMinted ${rows.length} token(s). Raw tokens above are shown ONCE — print or save now.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
