import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, notInArray, schema, sql, type Database } from "@restrobooth/db";
import type { SeatEligibilityDenialReason } from "@restrobooth/domain";

const TERMINAL_STATUSES = ["closed", "abandoned", "merged_into"];

export type SeatOrJoinResult =
  | { ok: true; tableSessionId: string; storeId: string }
  | { ok: false; reason: SeatEligibilityDenialReason };

/**
 * ADR-0008 amendment: a guest's scan now OPENS a table if nobody has,
 * rather than requiring staff to have seated it first — the owner's
 * explicit call, trading the "table must already be open" off-premises
 * defense for zero-friction self-service (see qrToken.ts's own header for
 * the full reasoning). This is the guest-facing analog of apps/pos's
 * applySeatTable (apps/pos/app/floor/actions.ts) — same shape (check for
 * a live session, resolve the open business day, resolve the one active
 * store), reimplemented here rather than imported since it also has to
 * handle "no live session yet, open one" instead of erroring on it.
 *
 * Runs pre-identity (no guest exists yet to scope RLS to), so this
 * deliberately takes a plain `Database`, same as
 * packages/db/src/guestToken.ts's lookupTokenByHash.
 *
 * Concurrency: `select ... for update` locks the table row for the
 * transaction's duration, so two guests scanning the SAME table's QR at
 * the same instant can't both pass the "no live session" check and each
 * create their own table_session — the second transaction blocks until
 * the first commits, then sees the now-claimed session and joins it.
 */
export async function seatOrJoinTableSession(
  db: Database,
  params: { outletId: string; tableId: string },
): Promise<SeatOrJoinResult> {
  return db.transaction(async (tx) => {
    const tableRows = await tx.execute<{ status: string }>(sql`
      select status from tables where id = ${params.tableId} for update
    `);
    const tableStatus = tableRows.rows[0]?.status ?? "out_of_service";

    const existing = await tx
      .select({ tableSessionId: schema.tableSessions.id, storeId: schema.tableSessions.storeId })
      .from(schema.tableSessionTables)
      .innerJoin(schema.tableSessions, eq(schema.tableSessionTables.tableSessionId, schema.tableSessions.id))
      .where(
        and(
          eq(schema.tableSessionTables.tableId, params.tableId),
          notInArray(schema.tableSessions.status, TERMINAL_STATUSES),
        ),
      )
      .orderBy(desc(schema.tableSessions.openedAt))
      .limit(1);

    // table_sessions.store_id is set once, at whoever-opens-it time (staff
    // OR now a guest) — a shared-cloud-kitchen table's brand ambiguity is
    // resolved here, not downstream. Joining an existing session just
    // inherits it, same as before this amendment.
    if (existing[0]) {
      return { ok: true, tableSessionId: existing[0].tableSessionId, storeId: existing[0].storeId };
    }

    if (tableStatus === "out_of_service") return { ok: false, reason: "table_out_of_service" };

    const bizday = await tx.execute<{ id: string }>(sql`
      select id from business_days where outlet_id = ${params.outletId} and status = 'open' limit 1
    `);
    const businessDayId = bizday.rows[0]?.id;
    if (!businessDayId) return { ok: false, reason: "outlet_not_open" };

    // Dine-in tables only exist at single-store outlets (same assumption
    // apps/pos's applySeatTable makes) — a genuinely misconfigured outlet
    // (zero or multiple active stores) is a setup bug, not a normal guest
    // outcome, so it throws rather than returning a denial reason; the
    // route's catch-all turns any thrown error into a generic /invalid.
    const stores = await tx.execute<{ id: string }>(sql`
      select id from stores where outlet_id = ${params.outletId} and status = 'active'
    `);
    if (stores.rows.length !== 1) {
      throw new Error(
        `expected exactly one active store at outlet ${params.outletId}, found ${stores.rows.length}`,
      );
    }
    const storeId = stores.rows[0]!.id;

    const tableSessionId = randomUUID();
    await tx.insert(schema.tableSessions).values({
      id: tableSessionId,
      outletId: params.outletId,
      storeId,
      businessDayId,
      status: "open",
      openedVia: "guest",
      idempotencyKey: randomUUID(),
    });
    await tx.insert(schema.tableSessionTables).values({ tableSessionId, tableId: params.tableId });

    return { ok: true, tableSessionId, storeId };
  });
}

export interface NewGuestSession {
  id: string;
  expiresAt: Date;
}

/** Guest session TTL — long enough for a full dine-in meal without forcing
 *  a rescan mid-service, short enough that a lost/left-behind phone stops
 *  being useful the same evening. */
export const GUEST_SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours

export async function createGuestSession(
  db: Database,
  params: { tableSessionId: string; storeId: string; qrTokenId: string },
): Promise<NewGuestSession> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + GUEST_SESSION_TTL_MS);

  await db.insert(schema.guestSessions).values({
    id,
    tableSessionId: params.tableSessionId,
    storeId: params.storeId,
    qrTokenId: params.qrTokenId,
    expiresAt,
  });

  return { id, expiresAt };
}
