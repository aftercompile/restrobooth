"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, schema, sql, withIdempotency } from "@restrobooth/db";
import { assertCanMerge, type TableSessionStatus } from "@restrobooth/domain";
import { queryAsCurrentUser } from "../../lib/db";

export type ActionState = { error: string | null };

/** See the identical, more fully-commented helper in
 *  ./[sessionId]/actions.ts — same fix, same reason. */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

export interface SeatTableInput {
  sessionId: string;
  tableId: string;
  outletId: string;
  covers: number;
}

/**
 * Seats one or more physical tables as a single party. Guards against
 * double-seating a table that's already claimed by a live session — the
 * schema has no unique constraint for this (a table can appear in more
 * than one table_session_tables row over its lifetime), so it's an
 * application-level check, done inside the same transaction as the insert.
 *
 * ADR-0004: the client generates `sessionId` (not this function) so the
 * UI can navigate to `/floor/{sessionId}` immediately, online or off, and
 * so a retried outbox entry is a no-op (`withIdempotency`) rather than a
 * second table_sessions row. No FormData, no redirect() — this is called
 * directly by the offline outbox drain (`lib/offline/outbox.ts`), which
 * is the ONLY caller; `SeatTableDialog.tsx` enqueues, it doesn't call this.
 */
export async function applySeatTable(idempotencyKey: string, input: SeatTableInput): Promise<{ sessionId: string }> {
  const { sessionId, tableId, outletId, covers } = input;
  if (!sessionId || !tableId || !outletId || !Number.isFinite(covers) || covers < 1) {
    throw new Error("missing or invalid seating details");
  }

  const result = await queryAsCurrentUser(async (tx) => {
    const { result } = await withIdempotency(
      tx,
      { key: idempotencyKey, outletId, endpoint: "seatTable", requestBody: input },
      async () => {
        const claimed = await tx.execute<{ id: string }>(sql`
          select ts.id from table_sessions ts
          join table_session_tables tst on tst.table_session_id = ts.id
          where tst.table_id = ${tableId}
            and ts.status not in ('closed', 'abandoned', 'merged_into')
          limit 1
        `);
        if (claimed.rows.length > 0) {
          throw new Error(`table already has a live session (${claimed.rows[0]!.id})`);
        }

        const bizday = await tx.execute<{ id: string }>(sql`
          select id from business_days where outlet_id = ${outletId} and status = 'open' limit 1
        `);
        const businessDayId = bizday.rows[0]?.id;
        if (!businessDayId) throw new Error("no open business day at this outlet — cannot seat a table");

        // Dine-in tables only exist at single-store outlets (a shared cloud
        // kitchen has no physical tables — see seed-believable-chain.ts's
        // Surat comment), so the store is resolved server-side rather than
        // asked of the cashier. A future multi-store dine-in outlet would
        // need a real picker here; surface a clear error rather than
        // silently guessing which brand is being served.
        const stores = await tx.execute<{ id: string }>(sql`
          select id from stores where outlet_id = ${outletId} and status = 'active'
        `);
        if (stores.rows.length !== 1) {
          throw new Error(
            `expected exactly one active store at this outlet, found ${stores.rows.length} — cannot auto-resolve which brand is being served`,
          );
        }
        const storeId = stores.rows[0]!.id;

        await tx.insert(schema.tableSessions).values({
          id: sessionId,
          outletId,
          storeId,
          businessDayId,
          status: "open",
          covers,
          idempotencyKey,
        });
        await tx.insert(schema.tableSessionTables).values({ tableSessionId: sessionId, tableId });

        return { sessionId };
      },
    );
    return result;
  });

  revalidatePath("/floor");
  return result;
}

/**
 * Merges `sourceSessionId` into `targetSessionId` (DOMAIN.md §3.1). Blocked
 * across stores by both `assertCanMerge` here (fast, friendly failure) and
 * the DB trigger (drizzle/0014 `enforce_merge_same_store` — the real
 * enforcement, in case a bug or a raw write ever bypasses this action).
 * Re-parents orders and kots to the target, then flips the source's own
 * status — all one transaction, so a partial merge can never be observed.
 */
export async function mergeSessions(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sourceSessionId = String(formData.get("sourceSessionId") ?? "");
  const targetSessionId = String(formData.get("targetSessionId") ?? "");
  if (!sourceSessionId || !targetSessionId) return { error: "Missing session ids." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const rows = await tx
        .select({ id: schema.tableSessions.id, storeId: schema.tableSessions.storeId, status: schema.tableSessions.status })
        .from(schema.tableSessions)
        .where(sql`${schema.tableSessions.id} in (${sourceSessionId}, ${targetSessionId})`);
      const source = rows.find((r) => r.id === sourceSessionId);
      const target = rows.find((r) => r.id === targetSessionId);
      if (!source || !target) throw new Error("session not found");

      assertCanMerge(
        { storeId: source.storeId, status: source.status as TableSessionStatus },
        { storeId: target.storeId, status: target.status as TableSessionStatus },
      );

      await tx.execute(
        sql`update orders set table_session_id = ${targetSessionId} where table_session_id = ${sourceSessionId}`,
      );
      await tx.execute(
        sql`update kots set table_session_id = ${targetSessionId} where table_session_id = ${sourceSessionId}`,
      );
      await tx
        .update(schema.tableSessions)
        .set({ status: "merged_into", mergedIntoSessionId: targetSessionId })
        .where(eq(schema.tableSessions.id, sourceSessionId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not merge the sessions." };
  }

  revalidatePath("/floor");
  redirect(`/floor/${targetSessionId}`);
}
