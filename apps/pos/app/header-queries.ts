import "server-only";
import { sql, type RlsTx } from "@restrobooth/db";

/**
 * The header's "awaiting payment" count — same definition FloorMap's own
 * per-table billStatus join uses ("printed" = a finalised bill that still
 * owes money), just aggregated across every outlet this user can see
 * instead of per-session. RLS on `bills` already scopes this the same way
 * every other cross-outlet count in this app is scoped (no manual outlet
 * filter needed — see getFloor()'s identical comment).
 */
export async function getAwaitingPaymentCount(tx: RlsTx): Promise<number> {
  const result = await tx.execute<{ [key: string]: unknown; awaiting: number }>(sql`
    select count(*)::int as awaiting from bills where status = 'finalised'
  `);
  return result.rows[0]?.awaiting ?? 0;
}

export interface InvoiceLookupResult {
  billId: string;
}

/**
 * The header search's invoice-number branch. `invoice_no` is unique per
 * (business_date) partition, not globally (drizzle/0000_init_schema.sql's
 * `bills_pkey` is (id, business_date)) — searching across every partition
 * for a plain string match is the correct, if slightly less indexed,
 * query for a low-frequency manual lookup like this; a cashier isn't
 * going to search invoice numbers hundreds of times a shift the way the
 * floor grid renders.
 */
export async function getBillByInvoiceNo(tx: RlsTx, invoiceNo: string): Promise<InvoiceLookupResult | null> {
  const result = await tx.execute<{ [key: string]: unknown; id: string }>(sql`
    select id from bills where invoice_no = ${invoiceNo} limit 1
  `);
  const row = result.rows[0];
  return row ? { billId: row.id } : null;
}
