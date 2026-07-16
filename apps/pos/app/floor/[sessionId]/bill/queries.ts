import "server-only";
import { sql, type RlsTx } from "@restrobooth/db";
import { computeBill, type BillLineInput, type ComputeBillResult, type TaxRateInput } from "@restrobooth/domain";

export interface BillableSession {
  sessionId: string;
  outletId: string;
  storeId: string;
  businessDayId: string;
  businessDate: string;
  gstRegistrationId: string;
  terminalId: string;
  tableLabels: string;
  brandName: string;
  gstin: string;
  legalName: string;
  tradeName: string | null;
}

export async function getBillableSession(tx: RlsTx, sessionId: string): Promise<BillableSession | null> {
  const result = await tx.execute<{
    [key: string]: unknown;
    session_id: string;
    outlet_id: string;
    store_id: string;
    business_day_id: string;
    business_date: string;
    gst_registration_id: string;
    terminal_id: string;
    table_labels: string;
    brand_name: string;
    gstin: string;
    legal_name: string;
    trade_name: string | null;
  }>(sql`
    select
      ts.id as session_id, ts.outlet_id, ts.store_id, ts.business_day_id, bd.business_date,
      o.gst_registration_id, t.id as terminal_id,
      string_agg(distinct tb.label, ', ' order by tb.label) as table_labels,
      b.name as brand_name, gr.gstin, gr.legal_name, gr.trade_name
    from table_sessions ts
    join table_session_tables tst on tst.table_session_id = ts.id
    join tables tb on tb.id = tst.table_id
    join stores s on s.id = ts.store_id
    join brands b on b.id = s.brand_id
    join outlets o on o.id = ts.outlet_id
    join gst_registrations gr on gr.id = o.gst_registration_id
    join business_days bd on bd.id = ts.business_day_id
    join terminals t on t.outlet_id = ts.outlet_id
    where ts.id = ${sessionId}
    group by ts.id, bd.business_date, o.gst_registration_id, t.id, b.name, gr.gstin, gr.legal_name, gr.trade_name
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    sessionId: row.session_id,
    outletId: row.outlet_id,
    storeId: row.store_id,
    businessDayId: row.business_day_id,
    businessDate: row.business_date,
    gstRegistrationId: row.gst_registration_id,
    terminalId: row.terminal_id,
    tableLabels: row.table_labels,
    brandName: row.brand_name,
    gstin: row.gstin,
    legalName: row.legal_name,
    tradeName: row.trade_name,
  };
}

export interface BillableLine {
  orderItemId: string;
  name: string;
  quantity: number;
  unitPricePaise: string;
  taxClassId: string;
  taxRateBps: number;
}

/** Fired or served, non-voided order_items across every order this
 *  session has ever had (a merge re-parents orders onto the target
 *  session — Phase 3a — so this session may cover more than one order
 *  row by the time it's billed). */
export async function getBillableLines(tx: RlsTx, sessionId: string): Promise<BillableLine[]> {
  const result = await tx.execute<{
    [key: string]: unknown;
    order_item_id: string;
    name: string;
    quantity: number;
    unit_price_paise: string;
    tax_class_id: string;
    tax_rate_bps: number;
  }>(sql`
    select oi.id as order_item_id, mi.name, oi.quantity, oi.unit_price_paise, oi.tax_class_id, tc.rate_bps as tax_rate_bps
    from order_items oi
    join orders o on o.id = oi.order_id and o.business_date = oi.business_date
    join menu_items mi on mi.id = oi.menu_item_id
    join tax_classes tc on tc.id = oi.tax_class_id
    where o.table_session_id = ${sessionId} and oi.status in ('fired', 'served')
    order by oi.created_at
  `);
  return result.rows.map((r) => ({
    orderItemId: r.order_item_id,
    name: r.name,
    quantity: r.quantity,
    unitPricePaise: r.unit_price_paise,
    taxClassId: r.tax_class_id,
    taxRateBps: r.tax_rate_bps,
  }));
}

export interface BillPreviewInput {
  billDiscount?: { kind: "flat"; amountPaise: bigint } | { kind: "percent"; bps: number };
  serviceChargeBps?: number;
}

export interface BillPreview {
  lines: BillableLine[];
  computed: ComputeBillResult;
}

/**
 * The live, not-yet-finalised bill — computed via packages/domain's
 * computeBill, the exact same function the finalise Server Action calls.
 * Dine-in billing is always intra-state (the guest is physically at the
 * outlet) — DOMAIN.md §7.5's inter-state/IGST case is central-kitchen
 * stock transfers (Phase 8), a different transaction entirely.
 */
export async function computeBillPreview(tx: RlsTx, sessionId: string, input: BillPreviewInput = {}): Promise<BillPreview> {
  const lines = await getBillableLines(tx, sessionId);
  if (lines.length === 0) {
    return {
      lines,
      computed: computeBill({ lines: [], taxRates: [], isIntraState: true }),
    };
  }

  const billLines: BillLineInput[] = lines.map((l) => ({
    id: l.orderItemId,
    grossPaise: BigInt(l.unitPricePaise) * BigInt(l.quantity),
    taxClassId: l.taxClassId,
  }));
  const taxRates: TaxRateInput[] = Array.from(new Map(lines.map((l) => [l.taxClassId, l.taxRateBps])).entries()).map(
    ([taxClassId, rateBps]) => ({ taxClassId, rateBps }),
  );

  const subtotalPaise = billLines.reduce((sum, l) => sum + l.grossPaise, 0n);
  const charges =
    input.serviceChargeBps && input.serviceChargeBps > 0
      ? [
          {
            name: "service_charge",
            // Service charge is taxed at the principal supply's rate
            // (DOMAIN.md §5 rule 6) — approximated here as the FIRST tax
            // class present, since a dine-in bill in this project's scope
            // is realistically single-tax-class (food). A genuinely
            // mixed-rate bill would need a real "which class does the
            // charge belong to" choice; noted rather than silently
            // guessed for the multi-class case.
            taxClassId: taxRates[0]!.taxClassId,
            amountPaise: (subtotalPaise * BigInt(input.serviceChargeBps)) / 10_000n,
          },
        ]
      : [];

  const computed = computeBill({
    lines: billLines,
    taxRates,
    // exactOptionalPropertyTypes: spread only when actually set, or the
    // property exists with value `undefined`, which the money-domain
    // types (deliberately) don't accept as equivalent to "absent".
    ...(input.billDiscount !== undefined ? { billDiscount: input.billDiscount } : {}),
    charges,
    isIntraState: true,
  });

  return { lines, computed };
}

export interface ExistingBill {
  billId: string;
  invoiceNo: string | null;
  status: string;
  subtotalPaise: string;
  discountPaise: string;
  chargesPaise: string;
  taxPaise: string;
  roundOffPaise: string;
  payablePaise: string;
  paidPaise: string;
}

/** The session's most recent bill, whatever its status — a session
 *  realistically has at most one non-voided bill in flight at a time. */
export async function getLatestBill(tx: RlsTx, sessionId: string): Promise<ExistingBill | null> {
  const result = await tx.execute<{
    [key: string]: unknown;
    bill_id: string;
    invoice_no: string | null;
    status: string;
    subtotal_paise: string;
    discount_paise: string;
    charges_paise: string;
    tax_paise: string;
    round_off_paise: string;
    payable_paise: string;
    paid_paise: string;
  }>(sql`
    select
      b.id as bill_id, b.invoice_no, b.status, b.subtotal_paise, b.discount_paise,
      b.charges_paise, b.tax_paise, b.round_off_paise, b.payable_paise,
      coalesce((select sum(amount_paise) from payments p where p.bill_id = b.id and p.status = 'captured'), 0) as paid_paise
    from bills b
    where b.table_session_id = ${sessionId}
    order by b.finalised_at desc nulls last
    limit 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    billId: row.bill_id,
    invoiceNo: row.invoice_no,
    status: row.status,
    subtotalPaise: row.subtotal_paise,
    discountPaise: row.discount_paise,
    chargesPaise: row.charges_paise,
    taxPaise: row.tax_paise,
    roundOffPaise: row.round_off_paise,
    payablePaise: row.payable_paise,
    paidPaise: row.paid_paise,
  };
}

/** All bills a session has ever had, oldest first — a session normally
 *  has at most one non-voided bill in flight, but split-bill (item/guest
 *  or amount) produces several independent bills against the SAME
 *  session, a real one-to-many (see 0020's header note on bills.table_session_id). */
export async function getSessionBills(tx: RlsTx, sessionId: string): Promise<ExistingBill[]> {
  const result = await tx.execute<{
    [key: string]: unknown;
    bill_id: string;
    invoice_no: string | null;
    status: string;
    subtotal_paise: string;
    discount_paise: string;
    charges_paise: string;
    tax_paise: string;
    round_off_paise: string;
    payable_paise: string;
    paid_paise: string;
  }>(sql`
    select
      b.id as bill_id, b.invoice_no, b.status, b.subtotal_paise, b.discount_paise,
      b.charges_paise, b.tax_paise, b.round_off_paise, b.payable_paise,
      coalesce((select sum(amount_paise) from payments p where p.bill_id = b.id and p.status = 'captured'), 0) as paid_paise
    from bills b
    where b.table_session_id = ${sessionId}
    order by b.finalised_at asc nulls last
  `);
  return result.rows.map((row) => ({
    billId: row.bill_id,
    invoiceNo: row.invoice_no,
    status: row.status,
    subtotalPaise: row.subtotal_paise,
    discountPaise: row.discount_paise,
    chargesPaise: row.charges_paise,
    taxPaise: row.tax_paise,
    roundOffPaise: row.round_off_paise,
    payablePaise: row.payable_paise,
    paidPaise: row.paid_paise,
  }));
}

export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPricePaise: string;
}

export interface InvoiceTaxLine {
  component: string;
  rateBps: number;
  taxablePaise: string;
  amountPaise: string;
}

export interface InvoicePayment {
  method: string;
  amountPaise: string;
  createdAt: string;
}

export interface InvoiceData {
  billId: string;
  invoiceNo: string | null;
  status: string;
  businessDate: string;
  finalisedAt: string | null;
  tableLabels: string;
  brandName: string;
  gstin: string;
  legalName: string;
  tradeName: string | null;
  outletName: string;
  outletAddress: unknown;
  subtotalPaise: string;
  discountPaise: string;
  chargesPaise: string;
  taxPaise: string;
  roundOffPaise: string;
  payablePaise: string;
  lines: InvoiceLine[];
  taxLines: InvoiceTaxLine[];
  payments: InvoicePayment[];
  creditNotes: { creditNoteNo: string; amountPaise: string; reasonCode: string; issuedAt: string }[];
}

/** The billed-at-the-time record for a finalised+ bill — reads the
 *  bill_lines/bill_tax_lines snapshot (0020), never live order_items, so a
 *  reprint always shows exactly what was invoiced. */
export async function getInvoiceData(tx: RlsTx, billId: string): Promise<InvoiceData | null> {
  const billResult = await tx.execute<{
    [key: string]: unknown;
    bill_id: string;
    invoice_no: string | null;
    status: string;
    business_date: string;
    finalised_at: string | null;
    table_labels: string;
    brand_name: string;
    gstin: string;
    legal_name: string;
    trade_name: string | null;
    outlet_name: string;
    outlet_address: unknown;
    subtotal_paise: string;
    discount_paise: string;
    charges_paise: string;
    tax_paise: string;
    round_off_paise: string;
    payable_paise: string;
  }>(sql`
    select
      b.id as bill_id, b.invoice_no, b.status, b.business_date, b.finalised_at,
      coalesce(
        (select string_agg(distinct tb.label, ', ' order by tb.label)
         from table_sessions ts
         join table_session_tables tst on tst.table_session_id = ts.id
         join tables tb on tb.id = tst.table_id
         where ts.id = b.table_session_id),
        '—'
      ) as table_labels,
      br.name as brand_name, gr.gstin, gr.legal_name, gr.trade_name,
      o.name as outlet_name, o.address as outlet_address,
      b.subtotal_paise, b.discount_paise, b.charges_paise, b.tax_paise, b.round_off_paise, b.payable_paise
    from bills b
    join stores s on s.id = b.store_id
    join brands br on br.id = s.brand_id
    join outlets o on o.id = b.outlet_id
    join gst_registrations gr on gr.id = b.gst_registration_id
    where b.id = ${billId}
  `);
  const row = billResult.rows[0];
  if (!row) return null;

  const linesResult = await tx.execute<{ [key: string]: unknown; name: string; quantity: number; unit_price_paise: string }>(sql`
    select name, quantity, unit_price_paise from bill_lines where bill_id = ${billId} order by name
  `);
  const taxLinesResult = await tx.execute<{
    [key: string]: unknown;
    component: string;
    rate_bps: number;
    taxable_paise: string;
    amount_paise: string;
  }>(sql`
    select component, rate_bps, taxable_paise, amount_paise from bill_tax_lines where bill_id = ${billId} order by component
  `);
  const paymentsResult = await tx.execute<{
    [key: string]: unknown;
    method: string;
    amount_paise: string;
    created_at: string;
  }>(sql`
    select method, amount_paise, created_at from payments where bill_id = ${billId} and status = 'captured' order by created_at
  `);
  const creditNotesResult = await tx.execute<{
    [key: string]: unknown;
    credit_note_no: string;
    amount_paise: string;
    reason_code: string;
    issued_at: string;
  }>(sql`
    select credit_note_no, amount_paise, reason_code, issued_at from credit_notes where bill_id = ${billId} order by issued_at
  `);

  return {
    billId: row.bill_id,
    invoiceNo: row.invoice_no,
    status: row.status,
    businessDate: row.business_date,
    finalisedAt: row.finalised_at,
    tableLabels: row.table_labels,
    brandName: row.brand_name,
    gstin: row.gstin,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    outletName: row.outlet_name,
    outletAddress: row.outlet_address,
    subtotalPaise: row.subtotal_paise,
    discountPaise: row.discount_paise,
    chargesPaise: row.charges_paise,
    taxPaise: row.tax_paise,
    roundOffPaise: row.round_off_paise,
    payablePaise: row.payable_paise,
    lines: linesResult.rows.map((r) => ({ name: r.name, quantity: r.quantity, unitPricePaise: r.unit_price_paise })),
    taxLines: taxLinesResult.rows.map((r) => ({
      component: r.component,
      rateBps: r.rate_bps,
      taxablePaise: r.taxable_paise,
      amountPaise: r.amount_paise,
    })),
    payments: paymentsResult.rows.map((r) => ({ method: r.method, amountPaise: r.amount_paise, createdAt: r.created_at })),
    creditNotes: creditNotesResult.rows.map((r) => ({
      creditNoteNo: r.credit_note_no,
      amountPaise: r.amount_paise,
      reasonCode: r.reason_code,
      issuedAt: r.issued_at,
    })),
  };
}
