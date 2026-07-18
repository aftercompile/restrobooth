import "server-only";
import { createDbClient, withUser, type Database, type RlsTx } from "@restrobooth/db";
import { createClient } from "./supabase/server";

/**
 * The KDS's single door to Postgres. Same pooling/caching discipline as
 * apps/pos/lib/db.ts — a fresh pool per call would exhaust Postgres
 * connections, so it's memoised at module scope and survives across
 * requests (reset only on a server restart / HMR reload).
 */
const globalForDb = globalThis as unknown as { __restroboothDb?: Database };

function getDb(): Database {
  if (!globalForDb.__restroboothDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (apps/kds/.env.local).");
    globalForDb.__restroboothDb = createDbClient(url);
  }
  return globalForDb.__restroboothDb;
}

/**
 * Runs `fn` against the database as the currently logged-in user, with RLS
 * applied. Throws if there is no session; every KDS route is behind auth,
 * so a missing session here means the caller is a route the proxy doesn't
 * cover, which is a bug, not a normal path.
 */
export async function queryAsCurrentUser<T>(fn: (tx: RlsTx, userId: string) => Promise<T>): Promise<T> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("queryAsCurrentUser called without a session");
  return withUser(getDb(), user.id, (tx) => fn(tx, user.id));
}
