"use server";

import { revalidatePath } from "next/cache";
import { eq, schema, sql, type RlsTx } from "@restrobooth/db";
import { assertOrderItemTransition, assertSessionTransition, groupByKitchenSection } from "@restrobooth/domain";
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

/**
 * Adds one item to the session's running order, creating the order itself
 * on first add (DOMAIN.md §1: one order per party, not one per round).
 * Price and tax class are re-resolved from resolve_menu() here — never
 * trusted from the client — so a stale picker never bills the wrong price.
 */
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

      // open -> ordering on the FIRST item only; a session already past
      // 'open' just gets another line, no transition needed.
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

/**
 * Fires every pending item on the session's order: groups them by kitchen
 * section (DOMAIN.md §3.3 — one KOT per hot/cold/bar line touched),
 * creates a KOT per group, attempts the (mock) print, and transitions the
 * session ordering -> dining on the first fire.
 */
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

      const nextKotNumberResult = await tx.execute<{ [key: string]: unknown; next: number }>(sql`
        select coalesce(max(kot_number), 0) + 1 as next from kots where outlet_id = ${session.outletId} and business_date = ${businessDate}
      `);
      let nextKotNumber = nextKotNumberResult.rows[0]!.next;

      for (const group of groups) {
        const kotId = crypto.randomUUID();
        await tx.insert(schema.kots).values({
          id: kotId,
          businessDate,
          outletId: session.outletId,
          storeId: session.storeId,
          tableSessionId: sessionId,
          orderId: order.id,
          kitchenSection: group.section,
          kotNumber: nextKotNumber++,
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
        const result = await mockPrinterBridge.send();
        if (result === "printed") {
          await tx.execute(sql`update kots set status = 'printed' where id = ${kotId}`);
        }

        const itemIds = sql.join(
          group.items.map((i) => sql`${i.id}`),
          sql`, `,
        );
        await tx.execute(sql`update order_items set status = 'fired' where id in (${itemIds})`);
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
      const result = await tx.execute(sql`update kots set reprint_count = reprint_count + 1 where id = ${kotId}`);
      if (result.rowCount === 0) throw new Error("KOT not found");
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not reprint." };
  }

  revalidatePath(`/floor/${sessionId}`);
  return OK;
}
