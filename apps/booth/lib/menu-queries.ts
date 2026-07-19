import "server-only";
import { sql } from "@restrobooth/db";
import { getDb } from "./db";

export interface BoothMenuItem {
  menuItemId: string;
  name: string;
  categoryName: string | null;
  pricePaise: string;
}

/**
 * resolve_menu() (packages/db/drizzle/0007) is the one menu-pricing
 * function — never a second menu source (CLAUDE.md). Deliberately
 * privileged (getDb(), not withGuest): resolve_menu inner-joins stores/
 * dayparts/promos, all RLS-gated to accessible_*_ids(), which is empty for
 * an anon guest — calling it under withGuest would silently return zero
 * rows, not an error. The menu itself is public data (only published
 * items, filtered by is_available below) with no per-guest isolation
 * concern, so a privileged read is correct here, unlike order status.
 *
 * Channel is hardcoded 'dinein' — a Booth guest at a seated table gets the
 * same pricing a captain/cashier would enter for them. A distinct 'booth'
 * channel is a Slice 2b question (it only matters once orders WRITE a
 * channel_code; browsing doesn't write anything).
 */
export async function getBoothMenu(storeId: string): Promise<BoothMenuItem[]> {
  const db = getDb();
  const result = await db.execute<{
    [key: string]: unknown;
    menu_item_id: string;
    name: string;
    category_name: string | null;
    price_paise: string;
  }>(sql`
    select mi.id as menu_item_id, mi.name, c.name as category_name, rm.price_paise
    from resolve_menu(${storeId}, 'dinein') rm
    join menu_items mi on mi.id = rm.menu_item_id
    left join categories c on c.id = mi.category_id
    where rm.is_available
    order by c.sort_order nulls last, mi.name
  `);
  return result.rows.map((r) => ({
    menuItemId: r.menu_item_id,
    name: r.name,
    categoryName: r.category_name,
    pricePaise: r.price_paise,
  }));
}
