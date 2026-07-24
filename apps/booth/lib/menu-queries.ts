import "server-only";
import { sql } from "@restrobooth/db";
import { getDb } from "./db";

export interface BoothMenuItem {
  menuItemId: string;
  name: string;
  categoryName: string | null;
  pricePaise: string;
  description: string | null;
  diet: string | null;
  allergens: string[];
  spiceLevel: string | null;
  tags: string[];
  /** Top-3-by-real-sales-in-this-store, never invented (CLAUDE.md: no
   *  metric the schema can't actually answer) — see the popularity
   *  subquery's comment below for the exact source. */
  isPopular: boolean;
}

const POPULAR_RANK_CUTOFF = 3;

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
 *
 * description/diet/allergens/spice_level/tags are real menu_items columns
 * that were simply never selected before this redesign — no schema
 * change. Popularity reuses the exact order_items subquery
 * apps/booth/lib/booth-host.ts's getRankedCandidates already computes
 * (real qty sold, this store, non-voided) rather than a second definition
 * of "popular" drifting out of sync with it.
 */
export async function getBoothMenu(storeId: string): Promise<BoothMenuItem[]> {
  const db = getDb();
  const result = await db.execute<{
    [key: string]: unknown;
    menu_item_id: string;
    name: string;
    category_name: string | null;
    price_paise: string;
    description: string | null;
    diet: string | null;
    allergens: string[];
    spice_level: string | null;
    tags: string[];
    qty_sold: string;
  }>(sql`
    select mi.id as menu_item_id, mi.name, c.name as category_name, rm.price_paise,
      mi.description, mi.diet, mi.allergens, mi.spice_level, mi.tags,
      coalesce(pop.qty_sold, 0) as qty_sold
    from resolve_menu(${storeId}, 'dinein') rm
    join menu_items mi on mi.id = rm.menu_item_id
    left join categories c on c.id = mi.category_id
    left join (
      select oi.menu_item_id, sum(oi.quantity) as qty_sold
      from order_items oi
      where oi.store_id = ${storeId} and oi.status != 'voided'
      group by oi.menu_item_id
    ) pop on pop.menu_item_id = mi.id
    where rm.is_available
    order by c.sort_order nulls last, mi.name
  `);

  const popularIds = new Set(
    result.rows
      .filter((r) => Number(r.qty_sold) > 0)
      .sort((a, b) => Number(b.qty_sold) - Number(a.qty_sold))
      .slice(0, POPULAR_RANK_CUTOFF)
      .map((r) => r.menu_item_id),
  );

  return result.rows.map((r) => ({
    menuItemId: r.menu_item_id,
    name: r.name,
    categoryName: r.category_name,
    pricePaise: r.price_paise,
    description: r.description,
    diet: r.diet,
    allergens: r.allergens,
    spiceLevel: r.spice_level,
    tags: r.tags,
    isPopular: popularIds.has(r.menu_item_id),
  }));
}
