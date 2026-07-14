/**
 * RLS adversarial suite infrastructure (docs/TENANCY.md §6). Raw `pg`
 * client, deliberately NOT the Drizzle abstraction — ADR-0003: "the point
 * is to exercise exactly what a real request would see, RLS included."
 * Types cannot prove RLS works; only a real query as a real role can.
 *
 * Runs against the Supabase CLI local stack (real GoTrue, real auth.uid()),
 * per the Phase 1 planning decision — RLS is the risk that "ends the
 * company" (RISKS.md R6), so this suite pays the fidelity cost rather than
 * testing against the hand-rolled auth.uid() stub used for day-to-day
 * schema dev.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../../.env") });

// Supabase local stack's default direct-Postgres port (supabase/config.toml
// [db] port = 54322) — NOT the docker-compose dev instance on 54329, which
// only has the auth.uid() STUB, not real GoTrue-backed auth.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// The believable chain is seeded once, for both suites, by
// test/globalSetup.ts — see its header comment for why per-file seeding
// raced and broke the override suite.

/**
 * Runs `fn` as the given user, inside a transaction that's always rolled
 * back (tests never mutate the shared fixture). `role` is the Postgres
 * role PostgREST would have used: 'authenticated' for a logged-in user,
 * 'anon' for an anonymous Booth guest.
 */
export async function asUser<T>(
  client: pg.Client,
  userId: string,
  fn: (client: pg.Client) => Promise<T>,
  role: "authenticated" | "anon" = "authenticated",
): Promise<T> {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

/** Anonymous Booth guest, identified by their session id (not a user id). */
export async function asGuest<T>(
  client: pg.Client,
  guestSessionId: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role anon");
    await client.query("select set_config('request.jwt.claim.guest_session_id', $1, true)", [guestSessionId]);
    return await fn(client);
  } finally {
    await client.query("rollback");
  }
}

export function makeClient(): pg.Client {
  return new pg.Client({ connectionString: TEST_DATABASE_URL });
}
