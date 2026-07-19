import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as schema from "./schema/index.js";
import type { Database } from "./client.js";
import type { RlsTx } from "./rls.js";

/** sha256 — "store the HASH, never the token" (booth.ts's own comment on
 *  qr_tokens.token_hash). A raw token is only ever held in memory, for the
 *  brief moment between generating it and printing/returning it. */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  // 32 bytes = 256 bits of entropy, base64url so it's a clean URL path
  // segment with no encoding needed.
  return randomBytes(32).toString("base64url");
}

// A pilot's printed table tents are a physical, one-time-per-table cost —
// rotate rarely, not on a cadence that forces a reprint run nobody asked
// for. 180 days is "reprint a couple of times a year," not "every visit."
export const DEFAULT_TOKEN_ROTATION_DAYS = 180;

export interface MintedToken {
  id: string;
  rawToken: string;
  rotatesAt: Date;
}

/**
 * Mints a fresh table QR token, revoking whatever token the table
 * currently holds first — rotation, not accumulation, is the only mode
 * (matches the `one_live_token_per_table` partial unique index in
 * booth.ts: this function is the sole writer that could violate it, and it
 * never does, by construction). Safe to call on a table with no existing
 * token (first-time provisioning) or one with an already-revoked token.
 *
 * Returns the RAW token exactly once, for printing — it is never stored or
 * retrievable again after this call returns.
 */
export async function mintTableToken(
  db: Database,
  params: { outletId: string; tableId: string; rotationDays?: number },
): Promise<MintedToken> {
  await db
    .update(schema.qrTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.qrTokens.tableId, params.tableId), isNull(schema.qrTokens.revokedAt)));

  const rawToken = generateRawToken();
  const rotatesAt = new Date(Date.now() + (params.rotationDays ?? DEFAULT_TOKEN_ROTATION_DAYS) * 24 * 60 * 60 * 1000);
  const id = randomUUID();

  await db.insert(schema.qrTokens).values({
    id,
    outletId: params.outletId,
    tableId: params.tableId,
    tokenHash: hashToken(rawToken),
    rotatesAt,
  });

  return { id, rawToken, rotatesAt };
}

export interface QrTokenRow {
  id: string;
  outletId: string;
  tableId: string;
  revokedAt: Date | null;
  rotatesAt: Date;
}

/** Runs pre-identity, so it deliberately takes a plain `Database`, not an
 *  `RlsTx` — there is no guest (and no staff user) to scope RLS to yet.
 *  This IS the privileged step that establishes who gets to become one. */
export async function lookupTokenByHash(db: Database, tokenHash: string): Promise<QrTokenRow | null> {
  const rows = await db.select().from(schema.qrTokens).where(eq(schema.qrTokens.tokenHash, tokenHash));
  return rows[0] ?? null;
}

/**
 * Scopes the connection to one anonymous Booth guest for the duration of
 * `fn`, the guest-side counterpart to rls.ts's `withUser`. Sets `role anon`
 * (matching every `to anon` policy in 0005_rls_policies.sql) and the
 * `request.jwt.claim.guest_session_id` GUC the guest RLS policies join
 * against (0005_rls_policies.sql lines 230-243) — transaction-scoped for
 * the identical pooled-connection-leak reason `withUser` documents.
 */
export async function withGuest<T>(db: Database, guestSessionId: string, fn: (tx: RlsTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role anon`);
    await tx.execute(sql`select set_config('request.jwt.claim.guest_session_id', ${guestSessionId}, true)`);
    return fn(tx);
  });
}
