import { createHash } from "node:crypto";
import { sql, eq, schema, type RlsTx } from "@restrobooth/db";

/**
 * ADR-0007 §5 — "cache, keyed on a content hash." `menu_version` (or
 * whatever else makes a response stale) belongs in `parts`, not bolted
 * on separately — that's what makes invalidation automatic: publish a
 * menu change, `menu_version` changes, the hash changes, every old
 * cached response for that store simply stops being looked up again.
 * No manual cache-busting anywhere.
 */
export function cacheKey(feature: string, parts: (string | number | null | undefined)[]): string {
  const joined = [feature, ...parts.map((p) => String(p ?? ""))].join("|");
  return createHash("sha256").update(joined).digest("hex");
}

/** Null on a miss OR an expired entry — the caller can't tell the
 *  difference and doesn't need to; either way, go call the provider. */
export async function getCached(tx: RlsTx, key: string): Promise<string | null> {
  const row = (
    await tx
      .select({ response: schema.aiResponseCache.response })
      .from(schema.aiResponseCache)
      .where(eq(schema.aiResponseCache.cacheKey, key))
  )[0];
  if (!row) return null;

  const fresh = (
    await tx.execute<{ [key: string]: unknown; fresh: boolean }>(
      sql`select expires_at > now() as fresh from ai_response_cache where cache_key = ${key}`,
    )
  ).rows[0]?.fresh;
  return fresh ? row.response : null;
}

/** Upsert, not insert — two guests hitting the same preference-vector
 *  hash at nearly the same moment both computing a fresh response is a
 *  harmless race (same content either way), not worth locking against. */
export async function setCached(tx: RlsTx, key: string, feature: string, response: string, ttlMs: number): Promise<void> {
  await tx.execute(sql`
    insert into ai_response_cache (cache_key, feature, response, expires_at)
    values (${key}, ${feature}, ${response}, now() + (${ttlMs}::text || ' milliseconds')::interval)
    on conflict (cache_key) do update set response = excluded.response, expires_at = excluded.expires_at, created_at = now()
  `);
}
