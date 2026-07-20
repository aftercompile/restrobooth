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
   *  money; "paid" = every non-voided bill on this session is settled. A
   *  session can hold several bills at once (split-bill), so this is a
   *  summary, not a 1:1 read of a single row — see getFloor()'s lateral
   *  join for the exact aggregation. */
  billStatus: "printed" | "paid" | null;
  /** Optional guest name captured at seat time (SeatTableDialog) — real
   *  guest PII the moment it's non-null, see DECISIONS.md. Never required,
   *  never shown for an idle table (there's no session to attach it to). */
  guestName: string | null;
  /** 'guest' when a Booth scan opened this table itself, no staff seating
   *  (ADR-0008 amendment) — the staff-visibility safety net that trade
   *  accepted. Surfaced as a badge, not folded into the state chip (same
   *  "one channel encodes state with colour" rule the bill badge follows). */
  openedVia: "staff" | "guest" | null;
  /** Non-null when a guest has tapped "Call waiter" and staff haven't
   *  acknowledged it yet (Slice 2c). A second, independent signal from
   *  billStatus/openedVia — same footer slot, own badge. */
  waiterCalledAt: string | null;
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
  waiter_called_at: string | null;
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
      ts.id as session_id, ts.status as session_status, ts.covers, ts.opened_at, ts.store_id,
      ts.guest_name, ts.opened_via, ts.waiter_called_at,
      bs.bill_status
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
      select ts2.id, ts2.status, ts2.covers, ts2.opened_at, ts2.store_id, ts2.guest_name, ts2.opened_via, ts2.waiter_called_at
      from table_session_tables tst2
      join table_sessions ts2 on ts2.id = tst2.table_session_id
      where tst2.table_id = t.id
        and ts2.status not in ('closed', 'abandoned', 'merged_into')
      limit 1
    ) ts on true
    -- A session can hold several bills at once (split-bill, ADR/DOMAIN
    -- §5.9), so this is a summary across all of them, not a 1:1 read:
    -- "paid" only once every non-voided/discarded bill is settled, else
    -- "printed" if any bill is finalised and still owes money, else null
    -- (no bill raised yet — the table is just mid-order).
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
    waiterCalledAt: r.waiter_called_at,
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
