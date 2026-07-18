import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "./schema/index.js";
import type { RlsTx } from "./rls.js";

/**
 * ADR-0004 §2: same key + same body → return the stored response, never
 * re-execute. Same key + a DIFFERENT body → this, loudly — a client bug,
 * not something to paper over by picking one of the two bodies.
 */
export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`idempotency key ${key} was already used with a different request body`);
    this.name = "IdempotencyConflictError";
  }
}

/** Stable across key order and bigint values (JSON.stringify chokes on
 *  bigint otherwise, and every money field in this codebase is one). */
function hashRequestBody(body: unknown): string {
  const json = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? `${value}n` : value));
  return createHash("sha256").update(json).digest("hex");
}

export interface IdempotencyResult<T> {
  result: T;
  /** true if this call returned a PREVIOUSLY stored response without
   *  re-running `fn` — the caller should skip any "just happened" UI (a
   *  toast, a redirect params) that only makes sense the first time. */
  replayed: boolean;
}

/**
 * Wraps a mutation in ADR-0004's idempotency contract. MUST run inside the
 * same transaction as the mutation itself (`tx`, not a fresh connection) —
 * atomicity is what makes "insert the key row" and "do the actual write"
 * an all-or-nothing pair; a crash between the two can't happen because
 * there is no between, only commit or rollback.
 *
 * `result` is stored as JSON (`response` is jsonb) — callers must return
 * something JSON-safe (an id, a small plain object), never a bigint or a
 * Date directly.
 */
export async function withIdempotency<T>(
  tx: RlsTx,
  params: { key: string; outletId: string; endpoint: string; requestBody: unknown },
  fn: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  const requestHash = hashRequestBody(params.requestBody);

  const existing = (await tx.select().from(schema.idempotencyKeys).where(eq(schema.idempotencyKeys.key, params.key)))[0];
  if (existing) {
    if (existing.requestHash !== requestHash) throw new IdempotencyConflictError(params.key);
    return { result: existing.response as T, replayed: true };
  }

  const result = await fn();
  await tx.insert(schema.idempotencyKeys).values({
    key: params.key,
    outletId: params.outletId,
    endpoint: params.endpoint,
    requestHash,
    response: result as object,
  });
  return { result, replayed: false };
}
