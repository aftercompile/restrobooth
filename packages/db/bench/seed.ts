/**
 * The BENCHMARKS.md fixture generator. Path is pinned by docs/BENCHMARKS.md
 * — do not relocate.
 *
 * Two phases: seedDimensions() (small, via Drizzle — orgs/brands/outlets/
 * stores/menu/users) then the set-based SQL in ./generators/bulk_fact_data.sql
 * (large — orders/order_items/kots/bills/payments, millions of rows,
 * generated server-side per month, never row-by-row from this script).
 *
 * The month loop lives HERE, not inside a single PL/pgSQL function: a
 * function body can't COMMIT mid-execution, so looping 12 months inside
 * one function call is one multi-million-row transaction — no progress
 * visibility from any other session until it entirely finishes, and a
 * failure at row 8,000,000 rolls back every prior month too. Calling
 * generate_bench_month() once per month as separate statements gives each
 * month its own transaction: bounded WAL, real progress, and a failed
 * month doesn't cost the ones already committed. (Found this the hard
 * way — the first version had the loop inside SQL; a background run sat
 * at 0 visible rows for over a minute with no way to tell if it was
 * working or stuck, confirmed via pg_stat_activity that it was genuinely
 * running, just entirely invisible until commit. Restructured before
 * trusting a multi-hour run to it.)
 *
 * Usage:
 *   tsx bench/seed.ts --scale=tiny    # ~500 orders, current month only — correctness check
 *   tsx bench/seed.ts --scale=full    # the real 2.2M orders / 9M order_items fixture
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { seedDimensions, makeClient } from "./dimensions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const scale = process.argv.find((a) => a.startsWith("--scale="))?.split("=")[1] ?? "full";

async function main() {
  const db = makeClient();

  console.log(`[bench] Scale: ${scale}`);
  const t0 = Date.now();

  await seedDimensions(db);
  console.log(`[bench] Dimensions done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  console.log("[bench] Loading generator functions...");
  const generatorSql = readFileSync(path.resolve(here, "generators/bulk_fact_data.sql"), "utf8");
  await db.execute(generatorSql);

  const ordersPerOutletPerDay = scale === "tiny" ? 2 : 301; // 301 * 20 * 365 ≈ 2.2M
  const monthsBack = scale === "tiny" ? 0 : 12;
  // avg (min+max)/2 items/order: 3-5 -> 4/order, matching ERD.md §6's own
  // "~4 lines/order" assumption behind the 9M order_items target. 2-4
  // (avg 3) undershoots to ~6.6M — calibrated against a real single-month
  // timing run, not guessed.
  const itemsMin = scale === "tiny" ? 2 : 3;
  const itemsMax = scale === "tiny" ? 4 : 5;

  console.log(`[bench] business_days for the ${monthsBack + 1}-month window...`);
  await db.execute(`select generate_bench_business_days(${monthsBack})`);

  console.log(`[bench] Generating fact data month by month (orders/outlet/day=${ordersPerOutletPerDay})...`);
  const t1 = Date.now();
  for (let m = 0; m <= monthsBack; m++) {
    const tm = Date.now();
    const offset = monthsBack - m;
    await db.execute(`
      do $$
      declare
        month_start date := (date_trunc('month', now()) - interval '${offset} months')::date;
        month_end date := least((month_start + interval '1 month')::date, now()::date);
      begin
        if month_start < month_end then
          perform generate_bench_month(month_start, month_end, ${ordersPerOutletPerDay}, ${itemsMin}, ${itemsMax});
        end if;
      end;
      $$;
    `);
    const countResult = await db.execute<{ count: string }>("select count(*) from orders");
    const orderCount = countResult.rows[0]?.count ?? "?";
    console.log(
      `[bench]   month ${m + 1}/${monthsBack + 1} done in ${((Date.now() - tm) / 1000).toFixed(1)}s — orders so far: ${orderCount}`,
    );
  }
  console.log(`[bench] Fact data done in ${((Date.now() - t1) / 1000 / 60).toFixed(1)}min`);

  console.log("[bench] VACUUM ANALYZE (per BENCHMARKS.md's technique)...");
  await db.execute("vacuum analyze");

  console.log(`[bench] Total: ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
