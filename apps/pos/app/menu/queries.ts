import "server-only";
import { sql, type RlsTx } from "@restrobooth/db";

export interface MenuOverviewItem {
  storeId: string;
  brandName: string;
  outletId: string;
  outletName: string;
  menuItemId: string;
  name: string;
  categoryName: string | null;
  diet: string | null;
  pricePaise: string;
  isAvailable: boolean;
}

interface MenuOverviewRow {
  [key: string]: unknown;
  store_id: string;
  brand_name: string;
  outlet_id: string;
  outlet_name: string;
  menu_item_id: string;
  name: string;
  category_name: string | null;
  diet: string | null;
  price_paise: string;
  is_available: boolean;
}

/**
 * Every store this user can see (RLS-scoped, same "no manual outlet
 * filter needed" pattern as apps/pos/app/floor/queries.ts's getFloor()),
 * each resolved through resolve_menu() the SAME way the order pad's
 * picker does — this is not a second pricing engine, just the same
 * function without the `where rm.is_available` filter apps/pos/app/floor/
 * [sessionId]/queries.ts's getOrderableMenu() applies, because this
 * screen's whole point is to show 86'd items too (so staff can un-86
 * them), not hide them.
 */
export async function getMenuOverview(tx: RlsTx): Promise<MenuOverviewItem[]> {
  const result = await tx.execute<MenuOverviewRow>(sql`
    select
      s.id as store_id, b.name as brand_name, o.id as outlet_id, o.name as outlet_name,
      mi.id as menu_item_id, mi.name, c.name as category_name, mi.diet,
      rm.price_paise, rm.is_available
    from stores s
    join brands b on b.id = s.brand_id
    join outlets o on o.id = s.outlet_id
    join lateral resolve_menu(s.id, 'dinein') rm on true
    join menu_items mi on mi.id = rm.menu_item_id
    left join categories c on c.id = mi.category_id
    where s.status = 'active'
    order by o.name, b.name, c.sort_order nulls last, mi.name
  `);
  return result.rows.map((r) => ({
    storeId: r.store_id,
    brandName: r.brand_name,
    outletId: r.outlet_id,
    outletName: r.outlet_name,
    menuItemId: r.menu_item_id,
    name: r.name,
    categoryName: r.category_name,
    diet: r.diet,
    pricePaise: r.price_paise,
    isAvailable: r.is_available,
  }));
}
