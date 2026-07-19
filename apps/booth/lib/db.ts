import "server-only";
import { createDbClient, withGuest, type Database, type RlsTx } from "@restrobooth/db";
import { cookies } from "next/headers";
import { GUEST_SESSION_COOKIE } from "./guest-session";

/**
 * The Booth's single door to Postgres. Same pooling/caching discipline as
 * apps/pos/lib/db.ts — a fresh pool per call would exhaust Postgres
 * connections, so it's memoised at module scope and survives across
 * requests (reset only on a server restart / HMR reload).
 */
const globalForDb = globalThis as unknown as { __restroboothDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__restroboothDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (apps/booth/.env.local).");
    globalForDb.__restroboothDb = createDbClient(url);
  }
  return globalForDb.__restroboothDb;
}

/**
 * Runs `fn` scoped to the current guest session, with RLS applied via
 * withGuest(). Throws if there is no valid guest cookie — every Booth route
 * except /t/[token] and /invalid is behind middleware.ts requiring one, so
 * a missing cookie here means a route the middleware doesn't cover, which
 * is a bug, not a normal path (same shape as apps/pos/lib/db.ts's
 * queryAsCurrentUser).
 */
export async function queryAsGuest<T>(fn: (tx: RlsTx, guestSessionId: string) => Promise<T>): Promise<T> {
  const cookieStore = await cookies();
  const guestSessionId = cookieStore.get(GUEST_SESSION_COOKIE)?.value;
  if (!guestSessionId) throw new Error("queryAsGuest called without a guest session cookie");
  return withGuest(getDb(), guestSessionId, (tx) => fn(tx, guestSessionId));
}
