import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, notInArray, schema, type Database } from "@restrobooth/db";

export interface OpenTableSession {
  tableSessionId: string;
  storeId: string;
}

const TERMINAL_STATUSES = ["closed", "abandoned", "merged_into"];

/**
 * The A14 "screenshot from home" defense: a table only has an open session
 * while staff have actually seated it. Runs pre-identity (no guest exists
 * yet to scope RLS to), so this deliberately takes a plain `Database`, same
 * as packages/db/src/guestToken.ts's lookupTokenByHash.
 *
 * `table_sessions.store_id` is already set by whoever seated the table
 * (DOMAIN.md §1) — a shared-cloud-kitchen table's brand ambiguity is
 * resolved there, at seat time, not here. The guest session simply
 * inherits it; no separate "which store" step is needed.
 */
export async function findOpenTableSession(db: Database, tableId: string): Promise<OpenTableSession | null> {
  const rows = await db
    .select({
      tableSessionId: schema.tableSessions.id,
      storeId: schema.tableSessions.storeId,
    })
    .from(schema.tableSessionTables)
    .innerJoin(schema.tableSessions, eq(schema.tableSessionTables.tableSessionId, schema.tableSessions.id))
    .innerJoin(schema.businessDays, eq(schema.tableSessions.businessDayId, schema.businessDays.id))
    .where(
      and(
        eq(schema.tableSessionTables.tableId, tableId),
        notInArray(schema.tableSessions.status, TERMINAL_STATUSES),
        eq(schema.businessDays.status, "open"),
      ),
    )
    .orderBy(desc(schema.tableSessions.openedAt))
    .limit(1);

  return rows[0] ?? null;
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
