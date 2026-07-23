import "server-only";
import { cookies } from "next/headers";
import { eq, schema } from "@restrobooth/db";
import { getDb } from "./db";
import { GUEST_SESSION_COOKIE } from "./guest-session";

export interface GuestContext {
  guestSessionId: string;
  storeId: string;
  outletId: string;
  tableSessionId: string;
  tableLabel: string;
  brandName: string;
  sessionStatus: string;
  waiterCalled: boolean;
  /** Whether the outlet has a UPI VPA configured (outlets.upi_vpa) — the
   *  Booth's "Pay via UPI app" method is only offered when true; an
   *  outlet can legitimately run cash/mock-only. */
  upiAvailable: boolean;
}

// A guest's table_session can turn terminal mid-visit (staff closes it, a
// merge folds it into another) without the guest's cookie itself expiring
// — this is the "is my session STILL live" check every Booth page runs
// first, not just "is there a cookie." "closed" is handled separately
// below — see getGuestContext's allowClosed param.
const ALWAYS_TERMINAL_STATUSES = ["abandoned", "merged_into"];

/**
 * Privileged (not withGuest) on purpose: this IS the check that decides
 * whether a guest gets scoped access at all — same "runs pre-decision, not
 * post-decision" shape as Slice 1's token gate. Everything downstream
 * (menu, order status) either uses this privileged path too (menu — public
 * data, no isolation concern) or switches to withGuest once the guest's
 * own identity is what's being scoped to (order status).
 *
 * `allowClosed` mirrors order-mutations.ts's resolveOwnSession — /pay is
 * the one page a guest can legitimately reload AFTER their own session
 * closed (the mock payment path closes it as part of settling), so it
 * opts in; every other page keeps the default reject.
 */
export async function getGuestContext(options: { allowClosed?: boolean } = {}): Promise<GuestContext | null> {
  const cookieStore = await cookies();
  const guestSessionId = cookieStore.get(GUEST_SESSION_COOKIE)?.value;
  if (!guestSessionId) return null;

  const db = getDb();
  const rows = await db
    .select({
      guestSessionId: schema.guestSessions.id,
      storeId: schema.guestSessions.storeId,
      tableSessionId: schema.guestSessions.tableSessionId,
      expiresAt: schema.guestSessions.expiresAt,
      sessionStatus: schema.tableSessions.status,
      waiterCalledAt: schema.tableSessions.waiterCalledAt,
      brandName: schema.brands.name,
      upiVpa: schema.outlets.upiVpa,
      outletId: schema.outlets.id,
    })
    .from(schema.guestSessions)
    // guest_sessions.table_session_id is nullable (a guest could in
    // principle scan before a session exists) — the inner join already
    // drops that case naturally, same effect as an explicit null check.
    .innerJoin(schema.tableSessions, eq(schema.guestSessions.tableSessionId, schema.tableSessions.id))
    .innerJoin(schema.stores, eq(schema.guestSessions.storeId, schema.stores.id))
    .innerJoin(schema.brands, eq(schema.stores.brandId, schema.brands.id))
    .innerJoin(schema.outlets, eq(schema.tableSessions.outletId, schema.outlets.id))
    .where(eq(schema.guestSessions.id, guestSessionId));

  const row = rows[0];
  if (!row || !row.tableSessionId) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  if (ALWAYS_TERMINAL_STATUSES.includes(row.sessionStatus)) return null;
  if (row.sessionStatus === "closed" && !options.allowClosed) return null;

  // A session can span multiple tables (a merge) — table_session_tables is
  // the join table, same relationship apps/pos's getSessionDetail() reads.
  const tableRows = await db
    .select({ label: schema.tables.label })
    .from(schema.tableSessionTables)
    .innerJoin(schema.tables, eq(schema.tableSessionTables.tableId, schema.tables.id))
    .where(eq(schema.tableSessionTables.tableSessionId, row.tableSessionId));

  return {
    guestSessionId: row.guestSessionId,
    storeId: row.storeId,
    outletId: row.outletId,
    tableSessionId: row.tableSessionId,
    tableLabel: tableRows.map((t) => t.label).join(", "),
    brandName: row.brandName,
    sessionStatus: row.sessionStatus,
    waiterCalled: row.waiterCalledAt !== null,
    upiAvailable: row.upiVpa !== null,
  };
}
