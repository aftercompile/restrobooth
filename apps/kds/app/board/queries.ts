import "server-only";
import { sql, type RlsTx } from "@restrobooth/db";

export interface TicketItem {
  orderItemId: string;
  name: string;
  quantity: number;
  prepNotes: string | null;
}

export interface Ticket {
  kotId: string;
  kotNumber: number;
  kitchenSection: string;
  status: string;
  reprintCount: number;
  firedAt: string;
  bumpedAt: string | null;
  outletId: string;
  outletName: string;
  brandName: string; // kots.store_id is display-only tagging (schema comment) — the shared-kitchen case
  tableLabels: string;
  covers: number;
  items: TicketItem[];
}

const ACTIVE_STATUSES = ["queued", "printed", "acknowledged", "preparing", "ready"] as const;

/**
 * Every active KOT this session can see (RLS scopes it to accessible
 * outlets — a shared cloud kitchen legitimately shows every store's
 * tickets on one screen, tagged by brand). `bumped`/`voided` are excluded
 * — DOMAIN.md §3.3's lifecycle ends at `bumped`, and this is the board a
 * cook works from, not a history view.
 *
 * Ordered by `kot_number` (per-outlet, per-business-day — DOMAIN.md §2),
 * not `fired_at`: two KOTs fired in the same instant across different
 * outlets have unrelated `fired_at` clocks, but `kot_number` is what a
 * cook actually reads off the ticket. Age itself is still computed from
 * `fired_at` client-side (DOMAIN.md §3.3 — never from `printed_at`).
 */
export async function getActiveTickets(tx: RlsTx): Promise<Ticket[]> {
  const statusList = sql.join(
    ACTIVE_STATUSES.map((s) => sql`${s}`),
    sql`, `,
  );

  const kotResult = await tx.execute<{
    [key: string]: unknown;
    kot_id: string;
    kot_number: number;
    kitchen_section: string;
    status: string;
    reprint_count: number;
    fired_at: string;
    bumped_at: string | null;
    outlet_id: string;
    outlet_name: string;
    brand_name: string;
    table_labels: string;
    covers: number;
  }>(sql`
    select
      k.id as kot_id, k.kot_number, k.kitchen_section, k.status, k.reprint_count, k.fired_at, k.bumped_at,
      k.outlet_id, o.name as outlet_name, b.name as brand_name,
      string_agg(distinct t.label, ', ' order by t.label) as table_labels,
      ts.covers
    from kots k
    join outlets o on o.id = k.outlet_id
    join stores s on s.id = k.store_id
    join brands b on b.id = s.brand_id
    join table_sessions ts on ts.id = k.table_session_id
    join table_session_tables tst on tst.table_session_id = ts.id
    join tables t on t.id = tst.table_id
    where k.status in (${statusList})
    group by k.id, k.business_date, k.kot_number, k.kitchen_section, k.status, k.reprint_count, k.fired_at, k.bumped_at,
             k.outlet_id, o.name, b.name, ts.covers
    order by k.kot_number
  `);

  const kotIds = kotResult.rows.map((r) => r.kot_id);
  const itemsByKot = new Map<string, TicketItem[]>();
  if (kotIds.length > 0) {
    const kotIdList = sql.join(
      kotIds.map((kid) => sql`${kid}`),
      sql`, `,
    );
    const itemsResult = await tx.execute<{
      [key: string]: unknown;
      kot_id: string;
      order_item_id: string;
      name: string;
      quantity: number;
      prep_notes: string | null;
    }>(sql`
      select ki.kot_id, ki.order_item_id, mi.name, ki.quantity, ki.prep_notes
      from kot_items ki
      join order_items oi on oi.id = ki.order_item_id
      join menu_items mi on mi.id = oi.menu_item_id
      where ki.kot_id in (${kotIdList})
      order by mi.name
    `);
    for (const r of itemsResult.rows) {
      const bucket = itemsByKot.get(r.kot_id);
      const item: TicketItem = { orderItemId: r.order_item_id, name: r.name, quantity: r.quantity, prepNotes: r.prep_notes };
      if (bucket) bucket.push(item);
      else itemsByKot.set(r.kot_id, [item]);
    }
  }

  return kotResult.rows.map((r) => ({
    kotId: r.kot_id,
    kotNumber: r.kot_number,
    kitchenSection: r.kitchen_section,
    status: r.status,
    reprintCount: r.reprint_count,
    firedAt: r.fired_at,
    bumpedAt: r.bumped_at,
    outletId: r.outlet_id,
    outletName: r.outlet_name,
    brandName: r.brand_name,
    tableLabels: r.table_labels,
    covers: r.covers,
    items: itemsByKot.get(r.kot_id) ?? [],
  }));
}
