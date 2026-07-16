import "server-only";
import { createDbClient, withUser, type Database, type RlsTx } from "@restrobooth/db";
import { createClient } from "./supabase/server";

/**
 * The captain app's single door to Postgres. Same pooling/caching
 * discipline as apps/pos/lib/db.ts.
 */
const globalForDb = globalThis as unknown as { __restroboothDb?: Database };

function getDb(): Database {
  if (!globalForDb.__restroboothDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (apps/captain/.env.local).");
    globalForDb.__restroboothDb = createDbClient(url);
  }
  return globalForDb.__restroboothDb;
}

/**
 * Runs `fn` against the database as the currently logged-in user, with RLS
 * (and the Phase 3a capability layer — drizzle/0014) applied.
 */
export async function queryAsCurrentUser<T>(fn: (tx: RlsTx, userId: string) => Promise<T>): Promise<T> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("queryAsCurrentUser called without a session");
  return withUser(getDb(), user.id, (tx) => fn(tx, user.id));
}
