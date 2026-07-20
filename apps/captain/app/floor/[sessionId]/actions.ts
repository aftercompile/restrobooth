"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, emitOrderStatusEvent, schema, sql, type RlsTx } from "@restrobooth/db";
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

/** See apps/pos's identical, more fully-commented helper — same fix. */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

async function getBusinessDate(tx: RlsTx, businessDayId: string): Promise<string> {
  const row = (await tx.select().from(schema.businessDays).where(eq(schema.businessDays.id, businessDayId)))[0];
  if (!row) throw new Error("business day not found");
  return row.businessDate;
}

/** Same logic as apps/pos's addOrderItem. */
export async function addOrderItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const menuItemId = String(formData.get("menuItemId") ?? "");
  const quantity = Number(formData.get("quantity") ?? 1);
  if (!sessionId || !menuItemId || !Number.isFinite(quantity) || quantity < 1) {
    return { error: "Missing or invalid item." };
  }

  try {
    await queryAsCurrentUser(async (tx) => {
      const session = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
      if (!session) throw new Error("session not found");
      // DOMAIN.md §3.1: the menu freezes once a bill has been requested —
      // same fix as apps/pos's addOrderItem, same reason.
      if (session.status !== "open" && session.status !== "ordering" && session.status !== "dining") {
        throw new Error(`cannot add an item — session is '${session.status}' (menu is frozen; ask a manager to un-freeze it)`);
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
        id: crypto.randomUUID(),
        businessDate,
        orderId,
        outletId: session.outletId,
        storeId: session.storeId,
        menuItemId,
        quantity,
        unitPricePaise: BigInt(price.price_paise),
        taxClassId: item.taxClassId,
        status: "pending",
        clientLineId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
      });

      if (session.status === "open") {
        assertSessionTransition("open", "ordering");
        await tx.update(schema.tableSessions).set({ status: "ordering" }).where(eq(schema.tableSessions.id, sessionId));
      }
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not add the item." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}

/** Same logic as apps/pos's fireOrder. */
export async function fireOrder(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return { error: "Missing session." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const session = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
      if (!session) throw new Error("session not found");

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

      for (const group of groups) {
        const kotId = crypto.randomUUID();
        const kotNumber = nextKotNumber++;
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

        const result = await mockPrinterBridge.send();
        if (result === "printed") {
          await tx.execute(sql`update kots set status = 'printed' where id = ${kotId}`);
        }

        const itemIds = sql.join(
          group.items.map((i) => sql`${i.id}`),
          sql`, `,
        );
        await tx.execute(sql`update order_items set status = 'fired' where id in (${itemIds})`);

        // ADR-0005: same event apps/pos's fireOrder emits — the KDS
        // doesn't know or care which app fired the ticket.
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
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not fire the order." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}

/** A pre-fire void — free, no manager auth (DOMAIN.md §3.2). Same logic
 *  as apps/pos's voidPendingItem. */
export async function voidPendingItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderItemId = String(formData.get("orderItemId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "guest_changed_mind");
  if (!orderItemId || !sessionId) return { error: "Missing item." };

  try {
    await queryAsCurrentUser(async (tx, userId) => {
      const item = (await tx.select().from(schema.orderItems).where(eq(schema.orderItems.id, orderItemId)))[0];
      if (!item) throw new Error("order item not found");
      if (item.status !== "pending") throw new Error("only a pending item can be voided for free — ask a manager for a fired item");
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
 * Requests a void on a fired item. Unlike apps/pos, the captain app has no
 * approve/reject UI — TENANCY.md §4 doesn't grant captain the "void a
 * fired KOT item" capability at all, so approving is a POS/manager action
 * by design. A captain can flag it (this action); a manager clears it from
 * the POS.
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
 * Releases a table without billing it — same action as apps/pos's
 * unseatSession (DOMAIN.md §3.1's `abandoned` status), mirrored here per
 * the owner's explicit request. Same scoping as POS: no manager gate (this
 * never touches a paise field or the ledger), no expense-ledger posting
 * (no ledger concept exists in this schema yet) — DOMAIN.md's fuller
 * "walkout" description is intentionally not built.
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

/**
 * "Call for bill" (PRD.md's own phrase for the captain's job). DOMAIN.md
 * §3.1: dining -> bill_requested freezes the menu for this session — an
 * item can't be added after the bill was asked for without an explicit
 * un-freeze, which is deliberately not exposed here (that's a POS/cashier
 * recovery action, not a captain one).
 */
export async function callForBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return { error: "Missing session." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const session = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
      if (!session) throw new Error("session not found");
      assertSessionTransition(session.status as "dining", "bill_requested");
      await tx.update(schema.tableSessions).set({ status: "bill_requested" }).where(eq(schema.tableSessions.id, sessionId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not call for the bill." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}
