/**
 * BENCH-02 (docs/BENCHMARKS.md): does live resolve_menu() hold up at 20
 * outlets x 200 items/brand x 6 channels? Correctness (the 21-row
 * precedence table) is a separate, already-passing suite
 * (test/override/precedence.test.ts) — BENCHMARKS.md is explicit that the
 * correctness gate runs BEFORE any timing number is reported, and it has.
 *
 * resolve_menu() is SECURITY DEFINER and reads its own tables directly —
 * it does not call accessible_outlet_ids()/accessible_store_ids() at all,
 * so unlike BENCH-01 there is no role/RLS variant to compare here; the
 * caller's identity is irrelevant to its cost.
 *
 * Two honest fixture gaps, both documented in docs/BENCHMARKS-RESULTS.md
 * rather than silently glossed over:
 *  - R2 ("dense overrides" on a non-dinein channel) is not actually
 *    denser than R1 in this fixture — bench/dimensions.ts's override rows
 *    are store-only (channel_code null, matches any channel), so R1 and
 *    R2 exercise the identical candidate set.
 *  - R3 ("during an active daypart + 2 active promos") still runs the
 *    resolver's active_dayparts/active_promos CTEs for real, but no bench
 *    override row references a daypart_id or promo_id, so the fixture
 *    doesn't exercise multi-dimension specificity competition — only the
 *    21-row correctness suite does that, deliberately, on a small fixture.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actAsSuperuser, explain, fmt, makeClient, timeRuns, type Stats } from "./util.js";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const client = makeClient();
  await client.connect();
  await actAsSuperuser(client); // resolve_menu() is SECURITY DEFINER; caller identity doesn't matter here

  const storesRes = await client.query<{ id: string }>(`select id from stores order by id limit 28`);
  const stores = storesRes.rows.map((r) => r.id);
  const oneStore = stores[0]!;
  const oneItemRes = await client.query<{ id: string }>(
    `select mi.id from menu_items mi join stores s on s.brand_id = mi.brand_id where s.id = $1 limit 1`,
    [oneStore],
  );
  const oneItem = oneItemRes.rows[0]!.id;

  const results: Record<string, Stats> = {};
  const explains: Record<string, string> = {};

  console.log(`[bench-02] R1: full menu, store=${oneStore}, channel=dinein, now`);
  results["R1"] = await timeRuns(client, `select * from resolve_menu($1, 'dinein', now())`, [oneStore], 200);
  console.log(`  ${fmt(results["R1"]!)}`);
  explains["R1"] = await explain(client, `select * from resolve_menu($1, 'dinein', now())`, [oneStore]);

  console.log(`[bench-02] R2: full menu, store=${oneStore}, channel=zomato, now`);
  results["R2"] = await timeRuns(client, `select * from resolve_menu($1, 'zomato', now())`, [oneStore], 200);
  console.log(`  ${fmt(results["R2"]!)}`);

  console.log(`[bench-02] R3: full menu, channel=zomato, at a timestamp inside a daypart window (17:30 local)`);
  const duringDaypart = new Date();
  duringDaypart.setUTCHours(12, 0, 0, 0); // 17:30 IST
  results["R3"] = await timeRuns(
    client,
    `select * from resolve_menu($1, 'zomato', $2)`,
    [oneStore, duringDaypart.toISOString()],
    200,
  );
  console.log(`  ${fmt(results["R3"]!)}`);

  console.log(`[bench-02] R4: resolve one item (cart/upsell path)`);
  results["R4"] = await timeRuns(
    client,
    `select * from resolve_menu($1, 'dinein', now()) where menu_item_id = $2`,
    [oneStore, oneItem],
    200,
  );
  console.log(`  ${fmt(results["R4"]!)}`);
  explains["R4"] = await explain(client, `select * from resolve_menu($1, 'dinein', now()) where menu_item_id = $2`, [
    oneStore,
    oneItem,
  ]);

  console.log(`[bench-02] R5: channel menu push — all 6 channels x 28 stores (batch)`);
  const channels = ["dinein", "zomato", "swiggy", "ondc", "direct", "captain"];
  const t0 = performance.now();
  for (const storeId of stores) {
    for (const channel of channels) {
      await client.query(`select * from resolve_menu($1, $2, now())`, [storeId, channel]);
    }
  }
  const r5Ms = performance.now() - t0;
  console.log(`  R5 total: ${r5Ms.toFixed(0)}ms for ${stores.length * channels.length} resolutions`);

  console.log(`[bench-02] R6: full menu at a future timestamp (scheduled price change, +30d)`);
  const future = new Date(Date.now() + 30 * 86400000);
  results["R6"] = await timeRuns(client, `select * from resolve_menu($1, 'dinein', $2)`, [oneStore, future.toISOString()], 200);
  console.log(`  ${fmt(results["R6"]!)}`);

  await client.end();

  const out = {
    results,
    r5TotalMs: r5Ms,
    r5Count: stores.length * channels.length,
    explains,
    storeCount: stores.length,
    overrideCountNote: "see docs/BENCHMARKS-RESULTS.md for the fixture's actual override row count",
    generatedAt: new Date().toISOString(),
  };
  const outPath = path.resolve(here, "../../bench-02-results.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[bench-02] Wrote ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
