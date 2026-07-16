import "server-only";
import { sql, type RlsTx } from "@restrobooth/db";

export interface DayStatus {
  outletId: string;
  outletName: string;
  businessDayId: string | null;
  businessDate: string | null;
  status: "open" | "closed" | "none";
  openedAt: string | null;
  terminalId: string | null;
  terminalName: string | null;
  drawerId: string | null;
  openingFloatPaise: string | null;
  countedPaise: string | null;
}

/**
 * Every outlet this session can see (RLS-scoped), with its current
 * business_day (if any open) and — since a day-open also opens that
 * outlet's one terminal's drawer (single-terminal-per-outlet, same
 * assumption apps/pos's seatTable action already makes for stores) — that
 * terminal's drawer row for the open day, if any.
 */
export async function getDayStatuses(tx: RlsTx): Promise<DayStatus[]> {
  const result = await tx.execute<{
    [key: string]: unknown;
    outlet_id: string;
    outlet_name: string;
    business_day_id: string | null;
    business_date: string | null;
    status: string | null;
    opened_at: string | null;
    terminal_id: string | null;
    terminal_name: string | null;
    drawer_id: string | null;
    opening_float_paise: string | null;
    counted_paise: string | null;
  }>(sql`
    select
      o.id as outlet_id, o.name as outlet_name,
      bd.id as business_day_id, bd.business_date, bd.status, bd.opened_at,
      t.id as terminal_id, t.name as terminal_name,
      d.id as drawer_id, d.opening_float_paise, d.counted_paise
    from outlets o
    left join business_days bd on bd.outlet_id = o.id and bd.status = 'open'
    left join terminals t on t.outlet_id = o.id
    left join terminal_day_drawers d on d.business_day_id = bd.id and d.terminal_id = t.id
    order by o.name
  `);

  return result.rows.map((r) => ({
    outletId: r.outlet_id,
    outletName: r.outlet_name,
    businessDayId: r.business_day_id,
    businessDate: r.business_date,
    status: r.business_day_id ? "open" : "closed",
    openedAt: r.opened_at,
    terminalId: r.terminal_id,
    terminalName: r.terminal_name,
    drawerId: r.drawer_id,
    openingFloatPaise: r.opening_float_paise,
    countedPaise: r.counted_paise,
  }));
}

export interface CloseChecklist {
  openTableSessions: number;
  unresolvedKots: number;
  unsettledBills: number;
}

/** DOMAIN.md §4.4's day-close checklist — the three counts that must all
 *  be zero before a day can close. */
export async function getCloseChecklist(tx: RlsTx, outletId: string, businessDayId: string): Promise<CloseChecklist> {
  const result = await tx.execute<{ [key: string]: unknown; open_sessions: number; unresolved_kots: number; unsettled_bills: number }>(sql`
    select
      (select count(*)::int from table_sessions where business_day_id = ${businessDayId}
         and status not in ('closed','merged_into','abandoned')) as open_sessions,
      (select count(*)::int from kots where outlet_id = ${outletId} and business_date = (select business_date from business_days where id = ${businessDayId})
         and status not in ('bumped','voided')) as unresolved_kots,
      (select count(*)::int from bills where outlet_id = ${outletId} and business_date = (select business_date from business_days where id = ${businessDayId})
         and status not in ('settled','voided','refunded_partial','refunded_full','discarded')) as unsettled_bills
  `);
  const row = result.rows[0]!;
  return {
    openTableSessions: row.open_sessions,
    unresolvedKots: row.unresolved_kots,
    unsettledBills: row.unsettled_bills,
  };
}

/** DOMAIN.md §4.4: expected = opening_float + cash_sales - cash_refunds.
 *  ("payouts" has no schema anywhere in this project yet — a documented
 *  gap, not silently folded in as zero without saying so.) */
export async function getExpectedCash(tx: RlsTx, businessDayId: string, terminalId: string, openingFloatPaise: bigint): Promise<bigint> {
  const result = await tx.execute<{ [key: string]: unknown; cash_sales: string; cash_refunds: string }>(sql`
    select
      coalesce(sum(p.amount_paise) filter (where p.status = 'captured'), 0) as cash_sales,
      coalesce(sum(p.amount_paise) filter (where p.status = 'refunded'), 0) as cash_refunds
    from payments p
    join bills b on b.id = p.bill_id and b.business_date = p.business_date
    where b.business_day_id = ${businessDayId} and b.terminal_id = ${terminalId} and p.method = 'cash'
  `);
  const row = result.rows[0]!;
  return openingFloatPaise + BigInt(row.cash_sales) - BigInt(row.cash_refunds);
}
