import { sql } from "drizzle-orm";
import type { Database } from "./client.js";

/** A transaction-scoped Drizzle handle — what `withUser`'s callback receives. */
export type RlsTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Runs `fn` with the connection scoped to a logged-in user, so every query
 * inside sees exactly the rows RLS allows that user — the production
 * equivalent of what `test/rls/fixtures.ts`'s `asUser` does for tests.
 *
 * Why a transaction: `set local role` and the `request.jwt.claim.sub` GUC
 * are both statement/transaction-local, and a pooled connection is shared
 * across requests — without wrapping in one transaction, the RLS context
 * could leak to the next request that borrows the same connection. The
 * transaction guarantees the scope is torn down (on COMMIT or ROLLBACK)
 * before the connection returns to the pool.
 *
 * We connect as `postgres` and `set local role authenticated` rather than
 * connecting as `authenticated` directly, exactly as the RLS test harness
 * does: `authenticated` is a non-login role in Supabase, and `SET ROLE`
 * drops superuser's RLS-bypass for the duration of the transaction so the
 * policies actually apply.
 */
export async function withUser<T>(
  db: Database,
  userId: string,
  fn: (tx: RlsTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role authenticated`);
    await tx.execute(sql`select set_config('request.jwt.claim.sub', ${userId}, true)`);
    return fn(tx);
  });
}
