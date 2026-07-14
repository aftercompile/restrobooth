/**
 * CI assertion: partitions exist for the next 3 months on every
 * partitioned table. A missing partition is an outage (inserts fail with
 * no matching partition) — docs/ERD.md §6 / adr/0002-data-retention.md.
 * Mirrors create_partitions_ahead()'s own table list and naming
 * (drizzle/0003_partition_maintenance.sql) rather than re-deriving it, so
 * the two can't drift apart silently.
 *
 * Usage: tsx scripts/check-partitions-ahead.ts
 * Exit 0 if every table has a partition for this month + the next 3;
 * exit 1 and print exactly which are missing otherwise.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbClient } from "../src/client.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const PARTITIONED_TABLES = [
  "orders", "order_items", "order_item_voids", "kots", "kot_items",
  "order_status_events", "bills", "bill_tax_lines", "payments",
];

const MONTHS_AHEAD = 3;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const db = createDbClient(url);

  const missing: string[] = [];
  const now = new Date();

  for (const table of PARTITIONED_TABLES) {
    for (let offset = 0; offset <= MONTHS_AHEAD; offset++) {
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const suffix = `${target.getUTCFullYear()}_${String(target.getUTCMonth() + 1).padStart(2, "0")}`;
      const partitionName = `${table}_${suffix}`;

      const result = await db.execute<{ exists: boolean }>(
        `select exists (
           select 1 from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
           where c.relname = '${partitionName}' and n.nspname = 'public'
         ) as exists`,
      );
      if (!result.rows[0]?.exists) missing.push(partitionName);
    }
  }

  if (missing.length > 0) {
    console.error(`Missing ${missing.length} partition(s) for the next ${MONTHS_AHEAD} months:`);
    for (const name of missing) console.error(`  - ${name}`);
    console.error("\nRun: select create_partitions_ahead();");
    process.exit(1);
  }

  console.log(`OK — all ${PARTITIONED_TABLES.length} partitioned tables have partitions through ${MONTHS_AHEAD} months ahead.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
