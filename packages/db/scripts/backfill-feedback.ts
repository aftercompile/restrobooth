/**
 * `pnpm --filter @restrobooth/db backfill:feedback` — Phase 6 Slice 4.
 * Seeds synthetic guest feedback (packages/db/scripts/data/steakhouse-
 * feedback.ts) onto Ember & Oak's ALREADY-IMPORTED sessions, instead of
 * requiring a full wipe-and-reimport of import-steakhouse.ts just to add
 * feedback rows — a much larger, riskier operation (Pass 2's DECISIONS.md
 * entry: the last full reimport needed re-running two other backfills and
 * dropped whatever incidental order history existed at the time). This
 * reads REAL sessions and their REAL ordered dish names already in the
 * DB, so a picked template only ever mentions a dish actually ordered in
 * that visit — never an invented one.
 *
 * Idempotent and re-runnable: only considers sessions that don't already
 * have a feedback row (whether from a real guest submission during live
 * testing, or a previous run of this script), so running it twice never
 * duplicates. Safe to run against local OR live — it only reads/writes
 * `feedback`, touching nothing else.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { createDbClient, type Database } from "../src/client.js";
import * as schema from "../src/schema/index.js";
import * as id from "./data/steakhouse-fixture-ids.js";
import { generateSyntheticFeedback, type FeedbackSessionMeta } from "./data/steakhouse-feedback.js";

// Same tiny seeded PRNG import-steakhouse.ts uses, deliberately duplicated
// rather than imported — this script must stay runnable independently of
// that generator's own in-memory state, same "standalone seed scripts
// don't share internals" precedent seed-believable-chain.ts's header sets.
function mulberry32(seed: number) {
  return function (): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function backfillFeedback(db: Database): Promise<void> {
  const existing = await db.execute<{ [key: string]: unknown; table_session_id: string }>(
    sql`select table_session_id from feedback where outlet_id = ${id.OUTLET}`,
  );
  const existingIds = new Set(existing.rows.map((r) => r.table_session_id));

  const rows = await db.execute<{
    [key: string]: unknown;
    session_id: string;
    business_date: string;
    closed_at: string;
    dish_name: string;
  }>(sql`
    select ts.id as session_id, o.business_date, ts.closed_at, mi.name as dish_name
    from table_sessions ts
    join orders o on o.table_session_id = ts.id
    join order_items oi on oi.order_id = o.id and oi.business_date = o.business_date
    join menu_items mi on mi.id = oi.menu_item_id
    where ts.outlet_id = ${id.OUTLET} and ts.store_id = ${id.STORE} and ts.status = 'closed' and ts.closed_at is not null
  `);

  const bySession = new Map<string, FeedbackSessionMeta>();
  for (const r of rows.rows) {
    if (existingIds.has(r.session_id)) continue;
    let meta = bySession.get(r.session_id);
    if (!meta) {
      meta = { sessionId: r.session_id, businessDate: r.business_date, closedAt: new Date(r.closed_at), dishNames: [] };
      bySession.set(r.session_id, meta);
    }
    meta.dishNames.push(r.dish_name);
  }

  const sessionMeta = Array.from(bySession.values());
  console.log(`${sessionMeta.length} sessions eligible (already had feedback: ${existingIds.size}).`);

  const rand = mulberry32(20260724);
  const feedbackRows = generateSyntheticFeedback(sessionMeta, rand, { outletId: id.OUTLET, storeId: id.STORE });
  console.log(`Inserting ${feedbackRows.length} feedback rows...`);
  if (feedbackRows.length > 0) await db.insert(schema.feedback).values(feedbackRows);
}

async function cliMain() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(here, "../../../.env") });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env at the repo root.");
  await backfillFeedback(createDbClient(url));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cliMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

export { backfillFeedback };
