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
      ts.id as session_id, ts.status as session_status, ts.covers, ts.opened_at, ts.store_id
    from tables t
    join areas a on a.id = t.area_id
    join outlets o on o.id = t.outlet_id
    left join lateral (
      select ts2.id, ts2.status, ts2.covers, ts2.opened_at, ts2.store_id
      from table_session_tables tst2
      join table_sessions ts2 on ts2.id = tst2.table_session_id
      where tst2.table_id = t.id
        and ts2.status not in ('closed', 'abandoned', 'merged_into')
      limit 1
    ) ts on true
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
  }));
}
