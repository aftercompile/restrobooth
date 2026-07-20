"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, emitOrderStatusEvent, schema, sql, withIdempotency, type RlsTx } from "@restrobooth/db";
import {
  assertOrderItemTransition,
  assertSessionTransition,
  groupByKitchenSection,
  type TableSessionStatus,
} from "@restrobooth/domain";
import { queryAsCurrentUser } from "../../../lib/db";
import { mockPrinterBridge } from "../../../lib/printerBridge";

export type ActionState = { error: string | null };
const OK: ActionState = { error: null };

/**
 * Walks DrizzleQueryError's .cause chain to find the real Postgres error
 * (its own .message is just "Failed query: <sql>" — apps/console hit this
 * exact trap in item-actions.ts). That wrapper message is dropped here,
 * not just walked past: joining it in would show a cashier a raw SQL dump
 * (query text, $1/$2 placeholders) instead of "insufficient privilege:
 * only org_owner... may authorize a post-fire void" — which is the whole
 * point of a friendly rejection message.
 */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

/**
 * business_date comes from the outlet's OPEN business_day row, never from
 * a clock (CLAUDE.md standing rule — Asia/Kolkata's business-day boundary
 * doesn't line up with a UTC/server "today" anyway).
 */
async function getBusinessDate(tx: RlsTx, businessDayId: string): Promise<string> {
  const row = (await tx.select().from(schema.businessDays).where(eq(schema.businessDays.id, businessDayId)))[0];
  if (!row) throw new Error("business day not found");
  return row.businessDate;
}

export interface AddOrderItemInput {
  sessionId: string;
  orderItemId: string;
  menuItemId: string;
  quantity: number;
  clientLineId: string;
}

/**
 * Adds one item to the session's running order, creating the order itself
 * on first add (DOMAIN.md §1: one order per party, not one per round).
 * Price and tax class are re-resolved from resolve_menu() here — never
 * trusted from the client — so a stale picker never bills the wrong price;
 * the client's own optimistic price (shown instantly, computed from the
 * page-load menu snapshot) is display-only and is simply superseded once
 * this applies, online or from the offline drain.
 *
 * ADR-0004: `orderItemId`/`clientLineId` are client-generated so a retried
 * outbox entry is a genuine no-op — `withIdempotency` short-circuits the
 * whole body, and `order_items`' own `(order_id, client_line_id)` unique
 * constraint is a second, independent backstop.
 */
export async function applyAddOrderItem(idempotencyKey: string, input: AddOrderItemInput): Promise<{ orderItemId: string }> {
  const { sessionId, orderItemId, menuItemId, quantity, clientLineId } = input;
  if (!sessionId || !orderItemId || !menuItemId || !clientLineId || !Number.isFinite(quantity) || quantity < 1) {
    throw new Error("missing or invalid item");
  }

  return queryAsCurrentUser(async (tx) => {
    const session = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
    if (!session) throw new Error("session not found");

    const { result } = await withIdempotency(
      tx,
      { key: idempotencyKey, outletId: session.outletId, endpoint: "addOrderItem", requestBody: input },
      async () => {
        // DOMAIN.md §3.1: "Menu is frozen for this session" once a bill has
        // been requested — an item added after the bill was asked for is
        // exactly the bug this rule exists to prevent. Un-freezing (back to
        // 'dining') is a deliberate, separate recovery action, not implied
        // by adding an item.
        if (session.status !== "open" && session.status !== "ordering" && session.status !== "dining") {
          throw new Error(`cannot add an item — session is '${session.status}' (menu is frozen; un-freeze it first)`);
        }

        const resolved = await tx.execute<{ [key: string]: unknown; price_paise: string; is_available: boolean }>(sql`
          select price_paise, is_available from resolve_menu(${session.storeId}, 'dinein') where menu_item_id = ${menuItemId}
        `);
        const price = resolved.rows[0];
        if (!price || !price.is_available) throw new Error("item is not available at this store right now");

        const item = (await tx.select().from(schema.menuItems).where(eq(schema.menuItems.id, menuItemId)))[0];
        if (!item) throw new Error("menu item not found");

        const businessDate = await getBusinessDate(tx, session.businessDayId);

        let orderId = (
          await tx.execute<{ [key: string]: unknown; id: string }>(sql`
            select id from orders where table_session_id = ${sessionId} and status = 'open' limit 1
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
            tableSessionId: sessionId,
            channelCode: "dinein",
            status: "open",
            idempotencyKey: crypto.randomUUID(),
          });
        }

        await tx.insert(schema.orderItems).values({
          id: orderItemId,
          businessDate,
          orderId,
          outletId: session.outletId,
          storeId: session.storeId,
          menuItemId,
          quantity,
          unitPricePaise: BigInt(price.price_paise),
          taxClassId: item.taxClassId,
          status: "pending",
          clientLineId,
          idempotencyKey: crypto.randomUUID(),
        });

        // open -> ordering on the FIRST item only; a session already past
        // 'open' just gets another line, no transition needed.
        if (session.status === "open") {
          assertSessionTransition("open", "ordering");
          await tx.update(schema.tableSessions).set({ status: "ordering" }).where(eq(schema.tableSessions.id, sessionId));
        }

        return { orderItemId };
      },
    );

    revalidatePath(`/floor/${sessionId}`);
    return result;
  });
}

export interface FireOrderInput {
  sessionId: string;
}

/**
 * Fires every pending item on the session's order: groups them by kitchen
 * section (DOMAIN.md §3.3 — one KOT per hot/cold/bar line touched),
 * creates a KOT per group, attempts the (mock) print, and transitions the
 * session ordering -> dining on the first fire.
 *
 * Takes no item-list argument — it fires whatever is 'pending' in the DB
 * at the moment it actually runs. That's safe under the offline outbox
 * (`lib/offline/outbox.ts`) specifically because the outbox drains
 * oldest-first: every `addOrderItem` entry the cashier enqueued before
 * this fire was enqueued (and therefore sorts earlier by UUIDv7) has
 * already been applied by the time this one's turn comes, online or on
 * reconnect — no explicit item-id handoff needed.
 */
export async function applyFireOrder(idempotencyKey: string, input: FireOrderInput): Promise<{ kotIds: string[] }> {
  const { sessionId } = input;
  if (!sessionId) throw new Error("missing session");

  return queryAsCurrentUser(async (tx) => {
    const session = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
    if (!session) throw new Error("session not found");

    const { result } = await withIdempotency(
      tx,
      { key: idempotencyKey, outletId: session.outletId, endpoint: "fireOrder", requestBody: input },
      async () => {
        const order = (
          await tx.execute<{ [key: string]: unknown; id: string }>(sql`
            select id from orders where table_session_id = ${sessionId} and status = 'open' limit 1
          `)
        ).rows[0];
        if (!order) throw new Error("nothing to fire — no open order on this session");

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
        if (pending.rows.length === 0) throw new Error("nothing to fire — no pending items");

        const groups = groupByKitchenSection(
          pending.rows.map((r) => ({
            id: r.id,
            kitchenSection: r.kitchen_section as "hot" | "cold" | "bar",
            quantity: r.quantity,
          })),
        );

        // Serializes kot_number allocation the same way scan-queries.ts's
        // seatOrJoinTableSession serializes seating (SELECT ... FOR UPDATE
        // on an existing row) rather than introducing a new locking
        // primitive with no precedent in this codebase. Matters now that
        // apps/booth's guest placeOrder() can fire the same outlet
        // concurrently — this staff path had a bare MAX+1 with no lock
        // until now (ADR-0009 flagged it as a fast-follow when the guest
        // path got this same fix).
        await tx.execute(sql`select id from business_days where id = ${session.businessDayId} for update`);
        const nextKotNumberResult = await tx.execute<{ [key: string]: unknown; next: number }>(sql`
          select coalesce(max(kot_number), 0) + 1 as next from kots where outlet_id = ${session.outletId} and business_date = ${businessDate}
        `);
        let nextKotNumber = nextKotNumberResult.rows[0]!.next;

        const kotIds: string[] = [];
        for (const group of groups) {
          const kotId = crypto.randomUUID();
          const kotNumber = nextKotNumber++;
          kotIds.push(kotId);
          await tx.insert(schema.kots).values({
            id: kotId,
            businessDate,
            outletId: session.outletId,
            storeId: session.storeId,
            tableSessionId: sessionId,
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
          // retry loop.
          const printResult = await mockPrinterBridge.send();
          if (printResult === "printed") {
            await tx.execute(sql`update kots set status = 'printed' where id = ${kotId}`);
          }

          const itemIds = sql.join(
            group.items.map((i) => sql`${i.id}`),
            sql`, `,
          );
          await tx.execute(sql`update order_items set status = 'fired' where id in (${itemIds})`);

          // ADR-0005: the event a KDS reconnect catches up from. Same
          // transaction as the KOT insert above — there is no way to
          // create a KOT without this committing alongside it.
          await emitOrderStatusEvent(tx, {
            outletId: session.outletId,
            businessDate,
            entityType: "kot",
            entityId: kotId,
            eventType: "kot.fired",
            payload: { kitchenSection: group.section, kotNumber },
          });
        }

        if (session.status === "ordering") {
          assertSessionTransition("ordering", "dining");
          await tx.update(schema.tableSessions).set({ status: "dining" }).where(eq(schema.tableSessions.id, sessionId));
        }

        return { kotIds };
      },
    );

    revalidatePath(`/floor/${sessionId}`);
    return result;
  });
}

/** A pre-fire void — free, no manager auth (DOMAIN.md §3.2). */
export async function voidPendingItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderItemId = String(formData.get("orderItemId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "guest_changed_mind");
  if (!orderItemId || !sessionId) return { error: "Missing item." };

  try {
    await queryAsCurrentUser(async (tx, userId) => {
      const item = (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.id, orderItemId)))[0];
      if (!item) throw new Error("order item not found");
      if (item.status !== "pending") throw new Error("only a pending item can be voided for free — use requestVoid");
      assertOrderItemTransition("pending", "voided");

      await tx.update(schema.orderItems).set({ status: "voided" }).where(eq(schema.orderItems.id, orderItemId));
      await tx.insert(schema.orderItemVoids).values({
        id: crypto.randomUUID(),
        businessDate: item.businessDate,
        orderItemId,
        outletId: item.outletId,
        storeId: item.storeId,
        quantityVoided: item.quantity,
        reasonCode,
        requiresAuth: false,
        voidedBy: userId,
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not void the item." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}

/**
 * Requests a void on a FIRED item — moves it to void_requested. Free to
 * request (anyone who can take an order); approving it is the gated step.
 */
export async function requestVoid(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderItemId = String(formData.get("orderItemId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!orderItemId || !sessionId) return { error: "Missing item." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const item = (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.id, orderItemId)))[0];
      if (!item) throw new Error("order item not found");
      assertOrderItemTransition(item.status as "fired", "void_requested");
      await tx.update(schema.orderItems).set({ status: "void_requested" }).where(eq(schema.orderItems.id, orderItemId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not request a void." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}

/**
 * Approves a requested void — the manager-gated step (DOMAIN.md §3.2,
 * TENANCY.md §4 "Void a fired KOT item"). Anyone can click this button;
 * whether it SUCCEEDS is enforced by the DB trigger
 * (enforce_void_authorization, drizzle/0014), which stamps authorized_by
 * from the caller's own session and rejects unless they hold a
 * void-authorizing role. No PIN pad in this phase — on a shared terminal a
 * manager approves by being the one signed in when they click it.
 */
export async function approveVoid(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderItemId = String(formData.get("orderItemId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "staff_error");
  if (!orderItemId || !sessionId) return { error: "Missing item." };

  try {
    await queryAsCurrentUser(async (tx, userId) => {
      const item = (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.id, orderItemId)))[0];
      if (!item) throw new Error("order item not found");
      assertOrderItemTransition(item.status as "void_requested", "voided");

      // requires_auth: true — the trigger stamps authorized_by itself and
      // rejects the whole insert if the caller isn't manager-capable, so a
      // cashier clicking this gets a clear rejection, not a silent no-op.
      await tx.insert(schema.orderItemVoids).values({
        id: crypto.randomUUID(),
        businessDate: item.businessDate,
        orderItemId,
        outletId: item.outletId,
        storeId: item.storeId,
        quantityVoided: item.quantity,
        reasonCode,
        requiresAuth: true,
        voidedBy: userId,
      });
      await tx.update(schema.orderItems).set({ status: "voided" }).where(eq(schema.orderItems.id, orderItemId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not approve the void." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}

/** Rejects a requested void — back to fired, nothing written. */
export async function rejectVoid(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderItemId = String(formData.get("orderItemId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!orderItemId || !sessionId) return { error: "Missing item." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const item = (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.id, orderItemId)))[0];
      if (!item) throw new Error("order item not found");
      assertOrderItemTransition(item.status as "void_requested", "fired");
      await tx.update(schema.orderItems).set({ status: "fired" }).where(eq(schema.orderItems.id, orderItemId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not reject the void." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}

/** A reprint increments reprint_count — it never creates a second KOT
 *  (DOMAIN.md §2, the "KOT printed twice" bug this schema exists to prevent). */
export async function reprintKot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kotId = String(formData.get("kotId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!kotId || !sessionId) return { error: "Missing KOT." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const kot = (await tx.select().from(schema.kots).where(eq(schema.kots.id, kotId)))[0];
      if (!kot) throw new Error("KOT not found");

      await tx.execute(sql`update kots set reprint_count = reprint_count + 1 where id = ${kotId}`);

      // Closes Phase 3a's deferred gap: a reprint never created a KOT
      // event at all before this. Still never a second KOT (DOMAIN.md §2)
      // — reprint_count is the only thing that changed.
      await emitOrderStatusEvent(tx, {
        outletId: kot.outletId,
        businessDate: kot.businessDate,
        entityType: "kot",
        entityId: kotId,
        eventType: "kot.reprinted",
        payload: { kitchenSection: kot.kitchenSection, kotNumber: kot.kotNumber, reprintCount: kot.reprintCount + 1 },
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not reprint." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}

/**
 * Releases a table without billing it — DOMAIN.md §3.1's `abandoned`
 * status, previously modeled in the domain state machine
 * (`assertSessionTransition`) but with no code path anywhere that could
 * actually reach it: there was no "undo an accidental seat" or "the guest
 * left, free the table" action on the floor at all.
 *
 * Deliberately NOT gated behind a manager capability the way a fired-item
 * void is. Unlike a void, this never touches a paise field, a bill, or the
 * ledger — it's a status change plus an audit-trail reason, and the reason
 * is always required (the DB's own `abandoned_reason_required` check
 * constraint backs this up regardless of what this action does). DOMAIN.md
 * §3.1 additionally describes a manager-authorized "walkout" flow that
 * posts an unsettled amount to a walkout expense line — no expense/ledger
 * concept exists anywhere in this schema yet, so that half is intentionally
 * not built here; this covers the common case (an empty or mis-seated
 * table), not a full walkout write-off.
 */
export async function unseatSession(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!sessionId) return { error: "Missing session." };
  if (!reason) return { error: "A reason is required." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const session = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
      if (!session) throw new Error("session not found");
      assertSessionTransition(session.status as TableSessionStatus, "abandoned");

      await tx
        .update(schema.tableSessions)
        .set({ status: "abandoned", abandonedReason: reason })
        .where(eq(schema.tableSessions.id, sessionId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not unseat the table." };
  }

  revalidatePath("/floor");
  redirect("/floor");
}
