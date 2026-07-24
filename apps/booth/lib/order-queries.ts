import "server-only";
import { sql, withGuest } from "@restrobooth/db";
import { getDb } from "./db";

export interface GuestOrderItem {
  orderItemId: string;
  menuItemId: string;
  name: string;
  quantity: number;
  status: string; // pending | fired | served | void_requested (voided is excluded)
  unitPricePaise: string;
}

export interface GuestKot {
  kotId: string;
  kotNumber: number;
  kitchenSection: string;
  status: string;
  firedAt: string;
}

export interface GuestOrderStatus {
  items: GuestOrderItem[];
  kots: GuestKot[];
}

/**
 * The live status board's read — scoped via withGuest (RLS: the
 * order_item_guest_own_read / kot_guest_own_read policies added in
 * migration 0026), unlike menu-queries.ts's privileged read. This IS a
 * per-guest isolation concern (another table's order must never leak), so
 * it goes through the same GUC-scoping mechanism Slice 1 built — the
 * explicit WHERE clauses below are belt-and-suspenders on top of RLS, the
 * same style apps/pos's getOpenOrder() uses even inside an already
 * user-scoped transaction.
 */
export async function getGuestOrderStatus(guestSessionId: string): Promise<GuestOrderStatus> {
  return withGuest(getDb(), guestSessionId, async (tx) => {
    const itemsResult = await tx.execute<{
      [key: string]: unknown;
      order_item_id: string;
      menu_item_id: string;
      name: string;
      quantity: number;
      status: string;
      unit_price_paise: string;
    }>(sql`
      select oi.id as order_item_id, oi.menu_item_id, mi.name, oi.quantity, oi.status, oi.unit_price_paise
      from order_items oi
      join menu_items mi on mi.id = oi.menu_item_id
      join orders o on o.id = oi.order_id
      where o.table_session_id = (
        select table_session_id from guest_sessions where id = ${guestSessionId}
      )
      and oi.status != 'voided'
      order by oi.created_at
    `);

    const kotsResult = await tx.execute<{
      [key: string]: unknown;
      kot_id: string;
      kot_number: number;
      kitchen_section: string;
      status: string;
      fired_at: string;
    }>(sql`
      select id as kot_id, kot_number, kitchen_section, status, fired_at
      from kots
      where table_session_id = (
        select table_session_id from guest_sessions where id = ${guestSessionId}
      )
      order by kot_number
    `);

    return {
      items: itemsResult.rows.map((r) => ({
        orderItemId: r.order_item_id,
        menuItemId: r.menu_item_id,
        name: r.name,
        quantity: r.quantity,
        status: r.status,
        unitPricePaise: r.unit_price_paise,
      })),
      kots: kotsResult.rows.map((r) => ({
        kotId: r.kot_id,
        kotNumber: r.kot_number,
        kitchenSection: r.kitchen_section,
        status: r.status,
        firedAt: r.fired_at,
      })),
    };
  });
}
