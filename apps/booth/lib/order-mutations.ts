import "server-only";
import { cookies } from "next/headers";
import { emitOrderStatusEvent, eq, schema, sql, type Database } from "@restrobooth/db";
import { assertSessionTransition, groupByKitchenSection, type KitchenSection } from "@restrobooth/domain";
import { getDb } from "./db";
import { GUEST_SESSION_COOKIE } from "./guest-session";
import { mockPrinterBridge } from "./printerBridge";

/**
 * ADR-0009: guest order writes run on a PRIVILEGED connection (no
 * `set local role` — the raw superuser pool from getDb()), not through
 * withGuest/RLS. An anon guest has no INSERT/UPDATE grant on any of these
 * tables and the staff-only capability policies would reject it outright
 * even if it did — see ADR-0009 for why that's a deliberate, scoped
 * exception to "RLS is the security model" rather than spreading the
 * guest trust boundary across six tables and two restrictive policies.
 *
 * What makes this safe: every mutation below resolves the caller's OWN
 * table_session from the `rb_guest_session` cookie FIRST, inside the SAME
 * transaction as the write that follows, and every subsequent write is
 * scoped to that resolved session — never to a client-supplied session or
 * table id. A guest can only ever affect the table their own cookie
 * belongs to.
 */

// Always-terminal for a guest, no exceptions: a merge re-parents this
// session's own items elsewhere, an abandon means staff force-closed it.
// "closed" is handled separately below — the one terminal status a guest
// still has a legitimate reason to act against (submitting feedback right
// after the mock gateway auto-settles and closes their own session).
const ALWAYS_TERMINAL_STATUSES = ["abandoned", "merged_into"];

export class GuestOrderError extends Error {}

export interface OwnSession {
  tableSessionId: string;
  outletId: string;
  storeId: string;
  businessDayId: string;
  status: string;
}

/**
 * The one function every guest mutation in this file (and
 * payment-mutations.ts) resolves through FIRST, inside the same
 * transaction as the write that follows — see this file's header comment
 * for why that ordering is what makes the whole privileged-connection
 * approach safe. `allowClosed` exists for exactly one caller
 * (submitFeedback): the mock payment path closes the session as part of
 * settling it, and the guest's own feedback prompt is shown immediately
 * after — resolving their session would otherwise reject it as terminal a
 * moment after they legitimately finished using it.
 */
export async function resolveOwnSession(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  options: { allowClosed?: boolean } = {},
): Promise<OwnSession> {
  const cookieStore = await cookies();
  const guestSessionId = cookieStore.get(GUEST_SESSION_COOKIE)?.value;
  if (!guestSessionId) throw new GuestOrderError("Your session has ended — please rescan the code on your table.");

  const rows = await tx
    .select({
      expiresAt: schema.guestSessions.expiresAt,
      tableSessionId: schema.tableSessions.id,
      outletId: schema.tableSessions.outletId,
      storeId: schema.tableSessions.storeId,
      businessDayId: schema.tableSessions.businessDayId,
      status: schema.tableSessions.status,
    })
    .from(schema.guestSessions)
    .innerJoin(schema.tableSessions, eq(schema.guestSessions.tableSessionId, schema.tableSessions.id))
    .where(eq(schema.guestSessions.id, guestSessionId));

  const row = rows[0];
  if (!row) throw new GuestOrderError("Your session has ended — please rescan the code on your table.");
  if (row.expiresAt.getTime() < Date.now()) throw new GuestOrderError("Your session has expired — please rescan the code on your table.");
  if (ALWAYS_TERMINAL_STATUSES.includes(row.status)) throw new GuestOrderError("This table is no longer active — please ask a staff member.");
  if (row.status === "closed" && !options.allowClosed) throw new GuestOrderError("This table is no longer active — please ask a staff member.");

  return row;
}

export async function getBusinessDate(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  businessDayId: string,
): Promise<string> {
  const row = (await tx.select().from(schema.businessDays).where(eq(schema.businessDays.id, businessDayId)))[0];
  if (!row) throw new GuestOrderError("This outlet's business day could not be found.");
  return row.businessDate;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

export function asResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  return fn()
    .then((value) => ({ ok: true as const, ...value }))
    .catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : "Something went wrong." }));
}

/** Same shape/logic as apps/captain's addOrderItem — always +1 per tap
 *  (no stepper anywhere in this design system; a second tap adds a
 *  second line, matching Captain's own UX exactly). */
export async function addToCart(menuItemId: string): Promise<Result<{ orderItemId: string }>> {
  const db = getDb();
  return asResult(() =>
    db.transaction(async (tx) => {
      const session = await resolveOwnSession(tx);
      if (!["open", "ordering", "dining"].includes(session.status)) {
        throw new GuestOrderError("This table's menu is frozen right now — please ask a staff member.");
      }

      const resolved = await tx.execute<{ [key: string]: unknown; price_paise: string; is_available: boolean }>(sql`
        select price_paise, is_available from resolve_menu(${session.storeId}, 'dinein') where menu_item_id = ${menuItemId}
      `);
      const price = resolved.rows[0];
      if (!price || !price.is_available) throw new GuestOrderError("That item isn't available right now.");

      const item = (await tx.select().from(schema.menuItems).where(eq(schema.menuItems.id, menuItemId)))[0];
      if (!item) throw new GuestOrderError("Menu item not found.");

      const businessDate = await getBusinessDate(tx, session.businessDayId);

      let orderId = (
        await tx.execute<{ [key: string]: unknown; id: string }>(sql`
          select id from orders where table_session_id = ${session.tableSessionId} and status = 'open' limit 1
        `)
      ).rows[0]?.id;

      if (!orderId) {
        orderId = crypto.randomUUID();
        await tx.insert(schema.orders).values({
          id: orderId,
          businessDate,
          outletId: session.outletId,
          storeId: session.storeId,
          businessDayId: session.businessDayId,
          tableSessionId: session.tableSessionId,
          channelCode: "dinein",
          status: "open",
          idempotencyKey: crypto.randomUUID(),
        });
      }

      const orderItemId = crypto.randomUUID();
      await tx.insert(schema.orderItems).values({
        id: orderItemId,
        businessDate,
        orderId,
        outletId: session.outletId,
        storeId: session.storeId,
        menuItemId,
        quantity: 1,
        unitPricePaise: BigInt(price.price_paise),
        taxClassId: item.taxClassId,
        status: "pending",
        clientLineId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      });

      if (session.status === "open") {
        assertSessionTransition("open", "ordering");
        await tx.update(schema.tableSessions).set({ status: "ordering" }).where(eq(schema.tableSessions.id, session.tableSessionId));
      }

      return { orderItemId };
    }),
  );
}

/** No audit row (unlike staff's voidPendingItem, which stamps voided_by) —
 *  a guest has no user id, and a never-fired, never-billed cart line has
 *  no audit obligation. Hard delete. Ownership is checked via the
 *  item's order belonging to the caller's own resolved table_session,
 *  not just "does this order_item id exist." */
export async function removeFromCart(orderItemId: string): Promise<Result<{ removed: true }>> {
  const db = getDb();
  return asResult(() =>
    db.transaction(async (tx) => {
      const session = await resolveOwnSession(tx);

      const item = (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.id, orderItemId)))[0];
      if (!item) throw new GuestOrderError("That item was not found.");
      if (item.status !== "pending") throw new GuestOrderError("That item has already been sent to the kitchen.");

      const order = (await tx.select().from(schema.orders).where(eq(schema.orders.id, item.orderId)))[0];
      if (!order || order.tableSessionId !== session.tableSessionId) {
        throw new GuestOrderError("That item isn't in your order.");
      }

      await tx.delete(schema.orderItems).where(eq(schema.orderItems.id, orderItemId));
      return { removed: true as const };
    }),
  );
}

/** The guest fire — same grouping/KOT/event/printer-bridge logic as
 *  apps/pos's applyFireOrder and apps/captain's fireOrder. Earlier this
 *  called no bridge at all, on the theory that "the kitchen's own printer
 *  bridge... picks it up the same as any other" — but there is no such
 *  standalone picker-upper; the mock bridge only ever runs inline in a
 *  fire action. That left every guest-fired KOT stuck in 'queued' forever,
 *  tripping the POS's 10s no-ACK alarm on 100% of QR orders instead of the
 *  ~1-in-6 rate staff-fired KOTs get. */
export async function placeOrder(): Promise<Result<{ kotCount: number }>> {
  const db = getDb();
  return asResult(() =>
    db.transaction(async (tx) => {
      const session = await resolveOwnSession(tx);

      const order = (
        await tx.execute<{ [key: string]: unknown; id: string }>(sql`
          select id from orders where table_session_id = ${session.tableSessionId} and status = 'open' limit 1
        `)
      ).rows[0];
      if (!order) throw new GuestOrderError("Your cart is empty.");

      const businessDate = await getBusinessDate(tx, session.businessDayId);

      const pending = await tx.execute<{
        [key: string]: unknown;
        id: string;
        kitchen_section: string;
        quantity: number;
      }>(sql`
        select oi.id, mi.kitchen_section, oi.quantity
        from order_items oi
        join menu_items mi on mi.id = oi.menu_item_id
        where oi.order_id = ${order.id} and oi.status = 'pending'
      `);
      if (pending.rows.length === 0) throw new GuestOrderError("Your cart is empty.");

      const groups = groupByKitchenSection(
        pending.rows.map((r) => ({
          id: r.id,
          kitchenSection: r.kitchen_section as KitchenSection,
          quantity: r.quantity,
        })),
      );

      // Serializes kot_number allocation the same way scan-queries.ts's
      // seatOrJoinTableSession serializes seating (SELECT ... FOR UPDATE
      // on an existing row) rather than introducing a new locking
      // primitive with no precedent in this codebase. Matters more here
      // than for the staff-only path this mirrors: a guest and staff can
      // now fire the same outlet concurrently.
      await tx.execute(sql`select id from business_days where id = ${session.businessDayId} for update`);
      const nextKotNumberResult = await tx.execute<{ [key: string]: unknown; next: number }>(sql`
        select coalesce(max(kot_number), 0) + 1 as next from kots where outlet_id = ${session.outletId} and business_date = ${businessDate}
      `);
      let nextKotNumber = nextKotNumberResult.rows[0]!.next;

      for (const group of groups) {
        const kotId = crypto.randomUUID();
        const kotNumber = nextKotNumber++;
        await tx.insert(schema.kots).values({
          id: kotId,
          businessDate,
          outletId: session.outletId,
          storeId: session.storeId,
          tableSessionId: session.tableSessionId,
          orderId: order.id,
          kitchenSection: group.section,
          kotNumber,
          status: "queued",
          idempotencyKey: crypto.randomUUID(),
        });
        for (const item of group.items) {
          await tx.insert(schema.kotItems).values({
            id: crypto.randomUUID(),
            businessDate,
            kotId,
            orderItemId: item.id,
            outletId: session.outletId,
            quantity: item.quantity,
          });
        }

        // The mock printer bridge — see lib/printerBridge.ts. A "queued"
        // result is left exactly as-is: the client's own 10s-no-ACK timer
        // (DOMAIN.md §3.3) is what surfaces a stuck ticket, not a server
        // retry loop. Same as apps/pos's applyFireOrder.
        const printResult = await mockPrinterBridge.send();
        if (printResult === "printed") {
          await tx.execute(sql`update kots set status = 'printed' where id = ${kotId}`);
        }

        const itemIds = sql.join(
          group.items.map((i) => sql`${i.id}`),
          sql`, `,
        );
        await tx.execute(sql`update order_items set status = 'fired' where id in (${itemIds})`);

        await emitOrderStatusEvent(tx, {
          outletId: session.outletId,
          businessDate,
          entityType: "kot",
          entityId: kotId,
          eventType: "kot.fired",
          payload: { kitchenSection: group.section, kotNumber, source: "booth" },
        });
      }

      if (session.status === "ordering") {
        assertSessionTransition("ordering", "dining");
        await tx.update(schema.tableSessions).set({ status: "dining" }).where(eq(schema.tableSessions.id, session.tableSessionId));
      }

      return { kotCount: groups.length };
    }),
  );
}

/**
 * Slice 2c — the guest service gesture. No menu-freeze/status guard beyond
 * resolveOwnSession's own terminal-session check: a guest at
 * bill_requested/settling can still need help, unlike adding an item. A
 * single nullable timestamp on table_sessions (non-null = outstanding
 * call) — both apps/pos's and apps/captain's floor views already
 * router.refresh() on any table_sessions change, so this surfaces to
 * staff live with no event/realtime plumbing of its own. Re-calling while
 * already called just re-stamps the same non-null state — harmless, no
 * guard needed.
 */
export async function callWaiter(): Promise<Result<{ called: true }>> {
  const db = getDb();
  return asResult(() =>
    db.transaction(async (tx) => {
      const session = await resolveOwnSession(tx);
      await tx
        .update(schema.tableSessions)
        .set({ waiterCalledAt: new Date() })
        .where(eq(schema.tableSessions.id, session.tableSessionId));
      return { called: true as const };
    }),
  );
}
