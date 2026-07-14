/**
 * BENCH-01 (docs/BENCHMARKS.md): does accessible_outlet_ids() hold up at
 * 20 outlets / 9M order_items, or does Postgres evaluate it once per row
 * instead of once per statement?
 *
 * Two things happen here:
 *  1. The real, shipped policies (variant B) are run for Q1-Q7, as all
 *     four role shapes, and checked against BENCHMARKS.md's thresholds —
 *     this is the actual pass/fail gate.
 *  2. A three-way A/B/C comparison (RLS off / wrapped+STABLE / naive
 *     VOLATILE) runs on Q1 and Q6 specifically — the two shapes that best
 *     represent "join through outlet+store scope" and "date-range
 *     aggregate" — rather than on all 7. The InitPlan-hoist effect is a
 *     property of the wrapper pattern itself, not of any one query shape,
 *     so re-deriving naive policies for all 7 tables in the query set
 *     would multiply the SQL plumbing without changing the conclusion.
 *
 * Q8 (the 15-case adversarial suite) is correctness, not latency, and
 * already has its own suite (test/rls/adversarial.test.ts, passing) — not
 * re-run here.
 */
import { writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actAs, actAsSuperuser, explain, fmt, makeClient, timeRuns, timeTransaction, type Stats } from "./util.js";
import { resolveFixtureRefs, type FixtureRefs } from "./fixture-refs.js";

const here = path.dirname(fileURLToPath(import.meta.url));

type SimpleQuery = { name: string; thresholdMs: number; sql: string; params: (r: FixtureRefs) => unknown[] };
type TxnQuery = {
  name: string;
  thresholdMs: number;
  txn: true;
  steps: (r: FixtureRefs) => { sql: string; params: unknown[] }[];
};
type QueryDef = SimpleQuery | TxnQuery;

function simpleQueries(r: FixtureRefs): SimpleQuery[] {
  return [
    {
      name: "Q1 POS hot path: order + items for one order",
      thresholdMs: 20,
      sql: `select oi.* from order_items oi where oi.order_id = $1 and oi.business_date = $2`,
      params: () => [r.orderId, r.businessDate],
    },
    {
      name: "Q2 POS menu load: resolve_menu(store, dinein, now())",
      thresholdMs: 50,
      sql: `select * from resolve_menu($1, 'dinein', now())`,
      params: () => [r.storeId],
    },
    {
      name: "Q3 KDS: KOTs fired in the 4h before this outlet's latest ticket",
      thresholdMs: 30,
      sql: `select k.* from kots k
            where k.outlet_id = $1
              and k.fired_at > (select max(fired_at) from kots where outlet_id = $1) - interval '4 hours'`,
      params: () => [r.outletId],
    },
    {
      name: "Q4 Floor map: table sessions for an outlet, one business_date",
      thresholdMs: 20,
      // Two precomputed timestamptz bounds, not `opened_at::date = $2` or
      // even `>= $2::date and < $2::date + interval '1 day'`. BENCH-01
      // caught both of those in sequence: the ::date cast defeated the
      // index outright (fixed by adding table_sessions_outlet_opened_idx
      // and switching to a range); the inline `date + interval`
      // arithmetic then turned out to ALSO defeat the planner specifically
      // when RLS's hashed SubPlan filters (accessible_outlet_ids /
      // accessible_store_ids) were present in the same WHERE clause —
      // confirmed via EXPLAIN: with RLS active, that expression made the
      // planner drop opened_at from the Bitmap Index Scan's Index Cond
      // entirely (fetching all ~113K rows for the outlet, 155-230ms);
      // with RLS bypassed, the same expression used the full composite
      // index fine. Two plain timestamptz literals sidestep the
      // interaction and restore the composite index scan either way —
      // 3ms, matching the RLS-off floor.
      sql: `select ts.* from table_sessions ts where ts.outlet_id = $1 and ts.opened_at >= $2::timestamptz and ts.opened_at < $3::timestamptz`,
      params: () => {
        const start = new Date(r.businessDate);
        const end = new Date(start.getTime() + 86400000);
        return [r.outletId, start.toISOString(), end.toISOString()];
      },
    },
    {
      name: "Q6 Report: day-end summary for one outlet, one business_date",
      thresholdMs: 200,
      sql: `select count(*), sum(payable_paise), sum(tax_paise) from bills where outlet_id = $1 and business_date = $2`,
      params: () => [r.outletId, r.businessDate],
    },
    {
      name: "Q7 Cluster report: 30-day summary across a cluster's outlets (live agg, no rollup table in Phase 1)",
      thresholdMs: 500,
      sql: `select o.outlet_id, count(*), sum(o.payable_paise)
            from bills o
            join outlet_group_members ogm on ogm.outlet_id = o.outlet_id
            where ogm.outlet_group_id = (select scope_id from memberships where role = 'cluster_manager' and user_id = $2)
              and o.business_date > $1::date - interval '30 days'
            group by o.outlet_id`,
      params: () => [r.businessDate, r.users.clusterManager],
    },
  ];
}

// Q5 is a real INSERT (bill + tax line + payment), always rolled back — no
// data persists. There is no invoice-numbering allocator yet (that's
// application logic, Phase 3a/domain), so invoice_no is a synthetic
// placeholder here; this measures the RLS WITH CHECK + constraint cost on
// the write path, not the real allocation flow.
function q5(r: FixtureRefs): TxnQuery {
  return {
    name: "Q5 Bill finalise: insert bill (rolled back) — RLS WITH CHECK + constraint cost on the write path",
    thresholdMs: 100,
    txn: true,
    steps: () => [
      {
        sql: `insert into bills (id, business_date, outlet_id, store_id, gst_registration_id, terminal_id,
                invoice_no, status, subtotal_paise, discount_paise, charges_paise, tax_paise,
                round_off_paise, payable_paise, idempotency_key, finalised_at)
              values (gen_random_uuid(), $2::date, $1, $3, $4, $5,
                'BENCH' || floor(random() * 100000)::text, 'finalised', 10000, 0, 0, 0, 0, 10000, gen_random_uuid(), now())
              returning id`,
        params: [r.outletId, r.businessDate, r.storeId, r.gstRegistrationId, r.terminalId],
      },
    ],
  };
}

function allQueries(r: FixtureRefs): QueryDef[] {
  const simple = simpleQueries(r);
  return [...simple.slice(0, 4), q5(r), ...simple.slice(4)];
}

type RoleName = "cashier" | "outletManager" | "clusterManager" | "orgOwner";

async function runOne(client: Awaited<ReturnType<typeof makeClient>>, q: QueryDef, refs: FixtureRefs): Promise<Stats> {
  if ("txn" in q) {
    const steps = q.steps(refs);
    return timeTransaction(client, steps, 50);
  }
  return timeRuns(client, q.sql, q.params(refs), 200);
}

async function runVariantB(refs: FixtureRefs) {
  const client = makeClient();
  await client.connect();
  const results: Record<string, Record<RoleName, Stats>> = {};
  const explains: Record<string, string> = {};

  const roles: RoleName[] = ["cashier", "outletManager", "clusterManager", "orgOwner"];
  for (const q of allQueries(refs)) {
    results[q.name] = {} as Record<RoleName, Stats>;
    for (const role of roles) {
      await actAs(client, refs.users[role]);
      const s = await runOne(client, q, refs);
      results[q.name]![role] = s;
      console.log(`  [B/${role}] ${q.name}: ${fmt(s)} (threshold ${q.thresholdMs}ms)`);
    }
    if (!("txn" in q)) {
      await actAs(client, refs.users.outletManager);
      explains[q.name] = await explain(client, q.sql, q.params(refs));
    }
  }
  await client.end();
  return { results, explains };
}

async function runVariantA(refs: FixtureRefs) {
  const client = makeClient();
  await client.connect();
  await actAsSuperuser(client);
  const results: Record<string, Stats> = {};
  for (const q of allQueries(refs)) {
    const s = await runOne(client, q, refs);
    results[q.name] = s;
    console.log(`  [A/bypass] ${q.name}: ${fmt(s)}`);
  }
  await client.end();
  return results;
}

async function runVariantC(refs: FixtureRefs) {
  const setupClient = makeClient();
  await setupClient.connect();
  await actAsSuperuser(setupClient);
  await setupClient.query(readFileSync(path.resolve(here, "naive-variant.sql"), "utf8"));
  await setupClient.end();

  const client = makeClient();
  await client.connect();
  await actAs(client, refs.users.outletManager);

  const q1 = simpleQueries(refs).find((q) => q.name.startsWith("Q1"))!;
  const q6 = simpleQueries(refs).find((q) => q.name.startsWith("Q6"))!;

  const q1Stats = await timeRuns(client, q1.sql, q1.params(refs), 200);
  console.log(`  [C/naive] ${q1.name}: ${fmt(q1Stats)}`);
  const q1Explain = await explain(client, q1.sql, q1.params(refs));

  const q6Stats = await timeRuns(client, q6.sql, q6.params(refs), 200);
  console.log(`  [C/naive] ${q6.name}: ${fmt(q6Stats)}`);
  const q6Explain = await explain(client, q6.sql, q6.params(refs));

  await client.end();

  const restoreClient = makeClient();
  await restoreClient.connect();
  await actAsSuperuser(restoreClient);
  await restoreClient.query(readFileSync(path.resolve(here, "restore-variant.sql"), "utf8"));
  await restoreClient.end();

  return { q1: q1Stats, q6: q6Stats, q1Explain, q6Explain };
}

async function main() {
  const refClient = makeClient();
  await refClient.connect();
  await actAsSuperuser(refClient);
  const refs = await resolveFixtureRefs(refClient);
  await refClient.end();
  console.log("[bench-01] Fixture refs resolved:", refs);

  console.log("\n=== Variant A (RLS bypass — the floor) ===");
  const variantA = await runVariantA(refs);

  console.log("\n=== Variant B (real, shipped policies) ===");
  const { results: variantB, explains } = await runVariantB(refs);

  console.log("\n=== Variant C (naive: VOLATILE, no InitPlan hoist) — Q1 & Q6 only ===");
  let variantC: Awaited<ReturnType<typeof runVariantC>>;
  try {
    variantC = await runVariantC(refs);
  } catch (e) {
    const restoreClient = makeClient();
    await restoreClient.connect();
    await actAsSuperuser(restoreClient);
    await restoreClient.query(readFileSync(path.resolve(here, "restore-variant.sql"), "utf8")).catch(() => {});
    await restoreClient.end();
    throw e;
  }

  const out = { refs, variantA, variantB, variantC, explains, generatedAt: new Date().toISOString() };
  const outPath = path.resolve(here, "../../bench-01-results.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n[bench-01] Wrote ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
