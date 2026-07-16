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
 * Every table this session can see (RLS already scopes it — no manual
 * outlet filter needed), left-joined to its currently OPEN session if any.
 * A table's own `status` column is a maintenance flag (available /
 * out_of_service), not occupancy — occupancy is derived here from whether
 * a non-terminal table_session currently claims the table (ERD.md §4.1).
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
    -- LATERAL, not a plain left join: a table accumulates one
    -- table_session_tables row per turnover (every past seating, not just
    -- the current one). A plain left join with the status filter in the ON
    -- clause doesn't drop those historical rows — it just nulls their ts.*
    -- columns — so a table that has ever turned over would appear once per
    -- past session PLUS once for the live one. LATERAL + LIMIT 1 picks
    -- only the single currently-active session per table, guaranteeing
    -- exactly one row per table regardless of turnover history.
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

export interface MergeCandidate {
  sessionId: string;
  tableLabels: string;
}

/** All open sessions at a store — the merge-target picker on the order pad. */
export async function getOpenSessionsForStore(
  tx: RlsTx,
  storeId: string,
  excludeSessionId: string,
): Promise<MergeCandidate[]> {
  const result = await tx.execute<{ session_id: string; table_labels: string }>(sql`
    select ts.id as session_id, string_agg(t.label, ', ' order by t.label) as table_labels
    from table_sessions ts
    join table_session_tables tst on tst.table_session_id = ts.id
    join tables t on t.id = tst.table_id
    where ts.store_id = ${storeId}
      and ts.id != ${excludeSessionId}
      and ts.status not in ('closed', 'abandoned', 'merged_into')
    group by ts.id
    order by table_labels
  `);
  return result.rows.map((r) => ({ sessionId: r.session_id, tableLabels: r.table_labels }));
}
