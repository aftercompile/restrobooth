import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../../.env") });

export const BENCH_DATABASE_URL =
  process.env.BENCH_DATABASE_URL ?? "postgresql://restrobooth:restrobooth@127.0.0.1:54329/restrobooth";

export function percentile(sortedMs: number[], p: number): number {
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)]!;
}

export type Stats = { p50: number; p95: number; p99: number; n: number };

export function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), n: sorted.length };
}

export function fmt(s: Stats): string {
  return `p50=${s.p50.toFixed(1)}ms p95=${s.p95.toFixed(1)}ms p99=${s.p99.toFixed(1)}ms (n=${s.n})`;
}

/** Times `runOnce` N times (default 200 per BENCHMARKS.md), returns stats. Discards the query result. */
export async function timeRuns(client: pg.Client, sql: string, params: unknown[], n = 200): Promise<Stats> {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await client.query(sql, params);
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

/**
 * Times a multi-statement transaction (begin / N steps / rollback) as one
 * unit. node-postgres's extended query protocol (used whenever params are
 * passed) accepts exactly one statement per call, so a "begin; insert...;
 * rollback;" string with params can't be sent in a single client.query() —
 * each step is its own round trip instead, and the whole sequence is what
 * gets timed.
 */
export async function timeTransaction(
  client: pg.Client,
  steps: { sql: string; params: unknown[] }[],
  n = 50,
): Promise<Stats> {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await client.query("begin");
    for (const step of steps) await client.query(step.sql, step.params);
    await client.query("rollback");
    samples.push(performance.now() - t0);
  }
  return stats(samples);
}

/** Runs EXPLAIN (ANALYZE, BUFFERS) once and returns the plan text, for the p95 case writeup. */
export async function explain(client: pg.Client, sql: string, params: unknown[]): Promise<string> {
  const r = await client.query(`explain (analyze, buffers, format text) ${sql}`, params);
  return r.rows.map((row: Record<string, string>) => row["QUERY PLAN"]).join("\n");
}

export function makeClient(): pg.Client {
  return new pg.Client({ connectionString: BENCH_DATABASE_URL });
}

/** Sets session context as a given app user, matching what PostgREST would set from a JWT. */
export async function actAs(client: pg.Client, userId: string): Promise<void> {
  await client.query(`set role authenticated`);
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
}

export async function actAsSuperuser(client: pg.Client): Promise<void> {
  await client.query(`reset role`);
}
