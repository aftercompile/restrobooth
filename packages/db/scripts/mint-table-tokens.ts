/**
 * Provisions (or re-provisions) every table's printed QR token — the thing
 * that actually gets printed onto a table tent for the Booth to work at
 * all. Prints `${BOOTH_URL}/t/{rawToken}` per table and renders an actual
 * scannable QR PNG next to it (`qr-codes/{outletCode}/{tableLabel}.png`);
 * the raw token is NEVER stored (mintTableToken hashes it before the
 * insert), so the printed text and the PNG are the only places it ever
 * exists in plaintext — save or print them now.
 *
 * Tokens rotate in `DEFAULT_TOKEN_ROTATION_DAYS` (180, guestToken.ts) —
 * a printed tent is a physical, one-time-per-table cost, not something to
 * force a reprint of on a short cadence.
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
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import QRCode from "qrcode";
import { createDbClient } from "../src/client.js";
import { mintTableToken } from "../src/guestToken.js";
import * as schema from "../src/schema/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");
const BOOTH_URL = process.env.BOOTH_URL ?? "http://localhost:3000";
const OUTPUT_DIR = path.resolve(here, "../qr-codes");

/** Table labels aren't guaranteed filename-safe (a manager could type
 *  anything in Console) — collapse anything but alphanumerics/dashes. */
function safeFileName(label: string): string {
  return label.replace(/[^a-z0-9-]+/gi, "_");
}

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
    const scanUrl = `${BOOTH_URL}/t/${rawToken}`;

    const outletDir = path.join(OUTPUT_DIR, row.outletCode);
    await mkdir(outletDir, { recursive: true });
    const pngPath = path.join(outletDir, `${safeFileName(row.tableLabel)}.png`);
    const pngBuffer = await QRCode.toBuffer(scanUrl, { type: "png", width: 512, margin: 2 });
    await writeFile(pngPath, pngBuffer);

    console.log(`  ${row.tableLabel}: ${scanUrl}  (rotates ${rotatesAt.toISOString().slice(0, 10)})`);
    console.log(`    -> ${pngPath}`);
  }

  console.log(`\nMinted ${rows.length} token(s). Raw tokens above are shown ONCE — print or save now. QR PNGs written under ${OUTPUT_DIR}.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
