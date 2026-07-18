/**
 * `pnpm purge` (local dev only) — clears every table_session and
 * everything that hangs off one, so every table on the floor goes back to
 * "available." Leaves tenancy (orgs/brands/outlets/stores), fixtures
 * (areas/tables/menu/tax classes), auth users, and invoice-numbering state
 * (invoice_series/invoice_number_blocks/invoice_number_gaps) untouched —
 * CLAUDE.md: a printed invoice number is never reused, even during a dev
 * reset, so that state survives this on purpose.
 *
 * A single `TRUNCATE table_sessions CASCADE` is enough: orders, kots,
 * order_items, kot_items, order_item_voids, bills, bill_lines,
 * bill_tax_lines, credit_notes, payments, and guest_sessions are all a
 * direct or transitive FK child of table_sessions, so Postgres walks the
 * whole dependency graph itself rather than this script hand-maintaining
 * delete order (see packages/db/drizzle/0000_init_schema.sql's FK block).
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbClient } from "../src/client.js";

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(here, "../../../.env") });
  // Root .env's DATABASE_URL points at the docker-compose Postgres
  // (54329) — a separate instance from the Supabase-local stack (54322)
  // the actual Next.js apps run against. PURGE_DATABASE_URL lets the
  // caller aim this at whichever one they mean instead of silently
  // guessing.
  const url = process.env.PURGE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set PURGE_DATABASE_URL (or DATABASE_URL) to the Postgres instance to purge.");
  }
  const db = createDbClient(url);
  console.log(`Purging order data at ${url.replace(/:[^:@]+@/, ":****@")} ...`);
  await db.execute(`truncate table table_sessions cascade`);
  console.log("Done — every table_session and its orders/kots/order_items/bills/payments are gone. Tables show as available.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
