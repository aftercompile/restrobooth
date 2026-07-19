import "server-only";
import { sql, type RlsTx } from "@restrobooth/db";

export interface FloorTable {
  tableId: string;
  label: string;
  capacity: number;
  outletId: string;
  outletName: string;
  areaId: string;
  areaName: string;
  sessionId: string | null;
  sessionStatus: string | null;
  covers: number | null;
  openedAt: string | null;
  storeId: string | null;
  /** null = no active bill yet; "printed" = a finalised bill still owes
   *  money; "paid" = every non-voided bill on this session is settled.
   *  Same aggregation as apps/pos/app/floor/queries.ts's getFloor(). */
  billStatus: "printed" | "paid" | null;
  /** Optional guest name captured at seat time — real guest PII the
   *  moment it's non-null, see DECISIONS.md. */
  guestName: string | null;
  /** 'guest' when a Booth scan opened this table itself, no staff seating
   *  (ADR-0008 amendment). Same badge apps/pos/app/floor/queries.ts adds. */
  openedVia: "staff" | "guest" | null;
}

interface FloorRow {
  [key: string]: unknown;
  table_id: string;
  label: string;
  capacity: number;
  outlet_id: string;
  outlet_name: string;
  area_id: string;
  area_name: string;
  session_id: string | null;
  session_status: string | null;
  covers: number | null;
  opened_at: string | null;
  store_id: string | null;
  bill_status: "printed" | "paid" | null;
  guest_name: string | null;
  opened_via: "staff" | "guest" | null;
}

/**
 * Same query as apps/pos/app/floor/queries.ts's getFloor — see that
 * file's comment for why this is a LATERAL join (a plain left join
 * duplicates a table once per past, closed session, not just the live
 * one). Duplicated rather than imported: each Next app in this monorepo
 * owns its own server-side query layer, same precedent as the auth wiring.
 */
export async function getFloor(tx: RlsTx): Promise<FloorTable[]> {
  const result = await tx.execute<FloorRow>(sql`
    select
      t.id as table_id, t.label, t.capacity,
      t.outlet_id, o.name as outlet_name,
      t.area_id, a.name as area_name,
      ts.id as session_id, ts.status as session_status, ts.covers, ts.opened_at, ts.store_id,
      ts.guest_name, ts.opened_via,
      bs.bill_status
    from tables t
    join areas a on a.id = t.area_id
    join outlets o on o.id = t.outlet_id
    left join lateral (
      select ts2.id, ts2.status, ts2.covers, ts2.opened_at, ts2.store_id, ts2.guest_name, ts2.opened_via
      from table_session_tables tst2
      join table_sessions ts2 on ts2.id = tst2.table_session_id
      where tst2.table_id = t.id
        and ts2.status not in ('closed', 'abandoned', 'merged_into')
      limit 1
    ) ts on true
    -- Same split-bill-aware summary as apps/pos's getFloor() — see that
    -- file's comment.
    left join lateral (
      select case
        when count(*) filter (where b.status not in ('voided', 'discarded')) > 0
         and count(*) filter (where b.status not in ('voided', 'discarded', 'settled')) = 0
          then 'paid'
        when count(*) filter (where b.status = 'finalised') > 0
          then 'printed'
        else null
      end as bill_status
      from bills b
      where b.table_session_id = ts.id
    ) bs on true
    where t.status = 'available'
    order by o.name, a.name, t.label
  `);

  return result.rows.map((r) => ({
    tableId: r.table_id,
    label: r.label,
    capacity: r.capacity,
    outletId: r.outlet_id,
    outletName: r.outlet_name,
    areaId: r.area_id,
    areaName: r.area_name,
    sessionId: r.session_id,
    sessionStatus: r.session_status,
    covers: r.covers,
    openedAt: r.opened_at,
    storeId: r.store_id,
    billStatus: r.bill_status,
    guestName: r.guest_name,
    openedVia: r.opened_via,
  }));
}
