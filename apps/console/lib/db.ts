import "server-only";
import { createDbClient, withUser, type Database, type RlsTx } from "@restrobooth/db";
import { createClient } from "./supabase/server";

/**
 * The console's single door to Postgres. `createDbClient` builds a fresh
 * pool each call, and Postgres connections must not be created per-request,
 * so the pool is memoised at module scope (surviving across requests, reset
 * only on a server restart / HMR reload via globalThis).
 *
 * Connects to the Supabase-local Postgres (port 54322) — the SAME database
 * GoTrue writes users into — so a session's user id resolves against real
 * auth.users rows. This is deliberately NOT the docker-compose dev instance
 * on 54329, which only has the auth.uid() stub.
 */
const globalForDb = globalThis as unknown as { __restroboothDb?: Database };

function getDb(): Database {
  if (!globalForDb.__restroboothDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (apps/console/.env.local).");
    globalForDb.__restroboothDb = createDbClient(url);
  }
  return globalForDb.__restroboothDb;
}

/**
 * Runs `fn` against the database as the currently logged-in user, with RLS
 * applied. Throws if there is no session — every console route is behind
 * auth (the middleware redirects unauthenticated requests to /login), so a
 * missing session here means the caller is a route that middleware doesn't
 * cover, which is a bug, not a normal path.
 */
export async function queryAsCurrentUser<T>(fn: (tx: RlsTx) => Promise<T>): Promise<T> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("queryAsCurrentUser called without a session");
  return withUser(getDb(), user.id, fn);
}
