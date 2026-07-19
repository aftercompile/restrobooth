import "server-only";
import { sql, type RlsTx } from "@restrobooth/db";

export interface SessionDetail {
  sessionId: string;
  status: string;
  storeId: string;
  outletId: string;
  businessDayId: string;
  covers: number;
  openedAt: string;
  tableLabels: string;
  brandName: string;
  guestName: string | null;
  guestPhone: string | null;
  guestNotes: string | null;
}

/** Same query as apps/pos's getSessionDetail. */
export async function getSessionDetail(tx: RlsTx, sessionId: string): Promise<SessionDetail | null> {
  const result = await tx.execute<{
    [key: string]: unknown;
    session_id: string;
    status: string;
    store_id: string;
    outlet_id: string;
    business_day_id: string;
    covers: number;
    opened_at: string;
    table_labels: string;
    brand_name: string;
    guest_name: string | null;
    guest_phone: string | null;
    guest_notes: string | null;
  }>(sql`
    select
      ts.id as session_id, ts.status, ts.store_id, ts.outlet_id, ts.business_day_id, ts.covers, ts.opened_at,
      ts.guest_name, ts.guest_phone, ts.guest_notes,
      string_agg(distinct t.label, ', ' order by t.label) as table_labels,
      b.name as brand_name
    from table_sessions ts
    join table_session_tables tst on tst.table_session_id = ts.id
    join tables t on t.id = tst.table_id
    join stores s on s.id = ts.store_id
    join brands b on b.id = s.brand_id
    where ts.id = ${sessionId}
    group by ts.id, b.name
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    status: row.status,
    storeId: row.store_id,
    outletId: row.outlet_id,
    businessDayId: row.business_day_id,
    covers: row.covers,
    openedAt: row.opened_at,
    tableLabels: row.table_labels,
    brandName: row.brand_name,
    guestName: row.guest_name,
    guestPhone: row.guest_phone,
    guestNotes: row.guest_notes,
  };
}

export interface OrderItemRow {
  orderItemId: string;
  businessDate: string;
  menuItemId: string;
  name: string;
  kitchenSection: string;
  quantity: number;
  unitPricePaise: string;
  taxClassId: string;
  status: string;
}

/** Same query as apps/pos's getOpenOrder. */
export async function getOpenOrder(
  tx: RlsTx,
  sessionId: string,
): Promise<{ orderId: string; businessDate: string; items: OrderItemRow[] } | null> {
  const orderResult = await tx.execute<{ [key: string]: unknown; id: string; business_date: string }>(sql`
    select id, business_date from orders
    where table_session_id = ${sessionId} and status = 'open'
    limit 1
  `);
  const order = orderResult.rows[0];
  if (!order) return null;

  const itemsResult = await tx.execute<{
    [key: string]: unknown;
    order_item_id: string;
    business_date: string;
    menu_item_id: string;
    name: string;
    kitchen_section: string;
    quantity: number;
    unit_price_paise: string;
    tax_class_id: string;
    status: string;
  }>(sql`
    select
      oi.id as order_item_id, oi.business_date, oi.menu_item_id, mi.name, mi.kitchen_section,
      oi.quantity, oi.unit_price_paise, oi.tax_class_id, oi.status
    from order_items oi
    join menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = ${order.id} and oi.status != 'voided'
    order by oi.created_at
  `);

  return {
    orderId: order.id,
    businessDate: order.business_date,
    items: itemsResult.rows.map((r) => ({
      orderItemId: r.order_item_id,
      businessDate: r.business_date,
      menuItemId: r.menu_item_id,
      name: r.name,
      kitchenSection: r.kitchen_section,
      quantity: r.quantity,
      unitPricePaise: r.unit_price_paise,
      taxClassId: r.tax_class_id,
      status: r.status,
    })),
  };
}

export interface KotSummary {
  kotId: string;
  kotNumber: number;
  kitchenSection: string;
  status: string;
}

/** Read-only KOT status for the captain — no reprint control here (that's
 *  a POS/cashier concern, TENANCY.md doesn't name it for captain). */
export async function getKotsForSession(tx: RlsTx, sessionId: string): Promise<KotSummary[]> {
  const result = await tx.execute<{
    [key: string]: unknown;
    kot_id: string;
    kot_number: number;
    kitchen_section: string;
    status: string;
  }>(sql`
    select id as kot_id, kot_number, kitchen_section, status
    from kots
    where table_session_id = ${sessionId}
    order by kot_number
  `);
  return result.rows.map((r) => ({
    kotId: r.kot_id,
    kotNumber: r.kot_number,
    kitchenSection: r.kitchen_section,
    status: r.status,
  }));
}

export interface OrderableMenuItem {
  menuItemId: string;
  name: string;
  categoryName: string | null;
  taxClassId: string;
  pricePaise: string;
  isAvailable: boolean;
}

/** Same query as apps/pos's getOrderableMenu. */
export async function getOrderableMenu(tx: RlsTx, storeId: string, channelCode: string): Promise<OrderableMenuItem[]> {
  const result = await tx.execute<{
    [key: string]: unknown;
    menu_item_id: string;
    name: string;
    category_name: string | null;
    tax_class_id: string;
    price_paise: string;
    is_available: boolean;
  }>(sql`
    select mi.id as menu_item_id, mi.name, c.name as category_name, mi.tax_class_id,
           rm.price_paise, rm.is_available
    from resolve_menu(${storeId}, ${channelCode}) rm
    join menu_items mi on mi.id = rm.menu_item_id
    left join categories c on c.id = mi.category_id
    where rm.is_available
    order by c.sort_order nulls last, mi.name
  `);
  return result.rows.map((r) => ({
    menuItemId: r.menu_item_id,
    name: r.name,
    categoryName: r.category_name,
    taxClassId: r.tax_class_id,
    pricePaise: r.price_paise,
    isAvailable: r.is_available,
  }));
}
