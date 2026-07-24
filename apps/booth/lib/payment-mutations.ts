import "server-only";
import { eq, schema, sql, type Database } from "@restrobooth/db";
import {
  assertSessionTransition,
  buildUpiIntentUrl,
  computeBill,
  financialYearFor,
  formatInvoiceNumber,
  type BillLineInput,
  type TaxRateInput,
} from "@restrobooth/domain";
import { getDb } from "./db";
import { GuestOrderError, asResult, getBusinessDate, resolveOwnSession, type Result } from "./order-mutations";
import { MockPaymentGateway } from "./payment-gateway";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const DEFAULT_SERIES_CODE = "A1"; // matches apps/pos/app/floor/[sessionId]/bill/actions.ts's own convention.

/**
 * ADR-0010: a guest can finalise their OWN bill — a deliberate duplicate
 * of apps/pos's applyFinalizeBill on the privileged connection (same
 * ADR-0009 tradeoff `placeOrder` already accepted vs. `fireOrder`), not an
 * import across apps. Reuses whatever staff already finalised if a bill
 * exists; a split bill (more than one finalised/settled bill on this
 * session) is out of scope for guest self-service and hands off to staff.
 */
export interface GuestBill {
  billId: string;
  invoiceNo: string;
  subtotalPaise: string;
  taxPaise: string;
  roundOffPaise: string;
  payablePaise: string;
  status: string;
}

export async function finalizeGuestBill(): Promise<Result<GuestBill>> {
  const db = getDb();
  return asResult(() =>
    db.transaction(async (tx) => {
      const session = await resolveOwnSession(tx);

      const existing = await tx.execute<{
        [key: string]: unknown;
        id: string;
        status: string;
        subtotal_paise: string;
        tax_paise: string;
        round_off_paise: string;
        payable_paise: string;
        invoice_no: string | null;
      }>(sql`
        select id, status, subtotal_paise, tax_paise, round_off_paise, payable_paise, invoice_no from bills where table_session_id = ${session.tableSessionId} and status <> 'voided'
      `);
      const active = existing.rows.filter((r) => r.status === "finalised" || r.status === "settled");
      if (active.length > 1) {
        throw new GuestOrderError("Your bill has been split at the table — please ask a staff member to help you pay.");
      }
      if (active.length === 1) {
        const b = active[0]!;
        return {
          billId: b.id,
          invoiceNo: b.invoice_no ?? "",
          subtotalPaise: b.subtotal_paise,
          taxPaise: b.tax_paise,
          roundOffPaise: b.round_off_paise,
          payablePaise: b.payable_paise,
          status: b.status,
        };
      }

      if (session.status !== "dining" && session.status !== "bill_requested") {
        throw new GuestOrderError("There's nothing to bill yet.");
      }

      const linesResult = await tx.execute<{
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
        where o.table_session_id = ${session.tableSessionId} and oi.status in ('fired', 'served')
        order by oi.created_at
      `);
      if (linesResult.rows.length === 0) {
        throw new GuestOrderError("There's nothing to bill yet — nothing has been sent to the kitchen.");
      }

      const billLines: BillLineInput[] = linesResult.rows.map((l) => ({
        id: l.order_item_id,
        grossPaise: BigInt(l.unit_price_paise) * BigInt(l.quantity),
        taxClassId: l.tax_class_id,
      }));
      const taxRates: TaxRateInput[] = Array.from(new Map(linesResult.rows.map((l) => [l.tax_class_id, l.tax_rate_bps])).entries()).map(
        ([taxClassId, rateBps]) => ({ taxClassId, rateBps }),
      );
      const computed = computeBill({ lines: billLines, taxRates, isIntraState: true });

      // Same "one terminal per outlet, first one found" assumption
      // apps/pos's getBillableSession makes — not improved on here.
      const termResult = await tx.execute<{ [key: string]: unknown; gst_registration_id: string; terminal_id: string }>(sql`
        select o.gst_registration_id, t.id as terminal_id from outlets o join terminals t on t.outlet_id = o.id where o.id = ${session.outletId} limit 1
      `);
      const term = termResult.rows[0];
      if (!term) throw new GuestOrderError("This outlet isn't set up for billing yet — please ask a staff member.");

      const businessDate = await getBusinessDate(tx, session.businessDayId);
      const fy = financialYearFor(businessDate);
      const seqResult = await tx.execute<{ [key: string]: unknown; seq: string }>(sql`
        select next_invoice_seq(${term.terminal_id}, ${term.gst_registration_id}, ${session.outletId}, ${DEFAULT_SERIES_CODE}, ${fy}) as seq
      `);
      const invoiceNo = formatInvoiceNumber(DEFAULT_SERIES_CODE, fy, BigInt(seqResult.rows[0]!.seq));

      const billId = crypto.randomUUID();
      await tx.insert(schema.bills).values({
        id: billId,
        businessDate,
        outletId: session.outletId,
        storeId: session.storeId,
        gstRegistrationId: term.gst_registration_id,
        terminalId: term.terminal_id,
        tableSessionId: session.tableSessionId,
        invoiceNo,
        status: "finalised",
        subtotalPaise: computed.subtotalPaise,
        discountPaise: computed.billDiscountPaise,
        chargesPaise: computed.chargesPaise,
        taxPaise: computed.taxTotalPaise,
        roundOffPaise: computed.roundOffPaise,
        payablePaise: computed.payablePaise,
        idempotencyKey: crypto.randomUUID(),
        finalisedAt: new Date(),
      });

      if (computed.taxLines.length > 0) {
        await tx.insert(schema.billTaxLines).values(
          computed.taxLines.map((t) => ({
            billId,
            businessDate,
            outletId: session.outletId,
            taxClassId: t.taxClassId,
            component: t.component,
            taxablePaise: t.taxablePaise,
            rateBps: t.rateBps,
            amountPaise: t.amountPaise,
          })),
        );
      }

      await tx.insert(schema.billLines).values(
        linesResult.rows.map((l) => ({
          id: crypto.randomUUID(),
          businessDate,
          billId,
          outletId: session.outletId,
          storeId: session.storeId,
          orderItemId: l.order_item_id,
          name: l.name,
          quantity: l.quantity,
          unitPricePaise: BigInt(l.unit_price_paise),
          taxClassId: l.tax_class_id,
          taxRateBps: l.tax_rate_bps,
        })),
      );

      if (session.status === "dining") {
        assertSessionTransition("dining", "bill_requested");
        assertSessionTransition("bill_requested", "settling");
      } else {
        assertSessionTransition("bill_requested", "settling");
      }
      await tx.update(schema.tableSessions).set({ status: "settling" }).where(eq(schema.tableSessions.id, session.tableSessionId));

      return {
        billId,
        invoiceNo,
        subtotalPaise: computed.subtotalPaise.toString(),
        taxPaise: computed.taxTotalPaise.toString(),
        roundOffPaise: computed.roundOffPaise.toString(),
        payablePaise: computed.payablePaise.toString(),
        status: "finalised",
      };
    }),
  );
}

/**
 * ADR-0010's hybrid settle model — the one place the three payment methods
 * genuinely diverge:
 *  - "mock": the stand-in for a real, verified gateway. Auto-captures and
 *    settles+closes immediately, same rule apps/pos's applySettleBill uses
 *    (captured sum >= payable ⇒ settled ⇒ session closes).
 *  - "cash" / "upi_intent": nobody here can verify a guest actually paid —
 *    writes a `pending` payment (the guest's CLAIM) and leaves the session
 *    'settling'. Staff confirm receipt on POS (confirmGuestPayment) to
 *    flip it to 'captured' and actually close the table. Real money stays
 *    staff-authoritative either way.
 */
export type GuestPaymentMethod = "mock" | "cash" | "upi_intent";

export interface GuestPaymentResult {
  settled: boolean;
  payablePaise: string;
  upiUrl?: string;
}

export async function payGuestBill(method: GuestPaymentMethod): Promise<Result<GuestPaymentResult>> {
  const db = getDb();
  return asResult(() =>
    db.transaction(async (tx) => {
      const session = await resolveOwnSession(tx);

      const billResult = await tx.execute<{ [key: string]: unknown; id: string; status: string; payable_paise: string; invoice_no: string | null }>(sql`
        select id, status, payable_paise, invoice_no from bills
        where table_session_id = ${session.tableSessionId} and status in ('finalised', 'settled')
        order by finalised_at desc limit 1
      `);
      const bill = billResult.rows[0];
      if (!bill) throw new GuestOrderError("Please request the bill before paying.");
      if (bill.status === "settled") return { settled: true, payablePaise: bill.payable_paise };

      // Idempotency: a guest re-tapping "Pay" (or a retried request) must
      // not create a second payment claim — no client-supplied key needed,
      // the bill can only ever have one active (pending or captured)
      // payment at a time in this single-tender flow.
      const activePayment = await tx.execute<{ [key: string]: unknown; status: string }>(sql`
        select status from payments where bill_id = ${bill.id} and status in ('pending', 'captured') limit 1
      `);
      if (activePayment.rows.length > 0) {
        return { settled: activePayment.rows[0]!.status === "captured", payablePaise: bill.payable_paise };
      }

      const businessDate = await getBusinessDate(tx, session.businessDayId);
      const payablePaise = BigInt(bill.payable_paise);

      if (method === "mock") {
        const result = await new MockPaymentGateway().charge(payablePaise);
        await tx.insert(schema.payments).values({
          id: crypto.randomUUID(),
          businessDate,
          billId: bill.id,
          outletId: session.outletId,
          storeId: session.storeId,
          // "upi_collect" is the closest legal enum value to "paid via an
          // online gateway flow" — gateway/gatewayTxnId are what actually
          // distinguish this as the mock, not the method value itself.
          method: "upi_collect",
          amountPaise: payablePaise,
          status: result.status === "captured" ? "captured" : "failed",
          gateway: "mock",
          gatewayTxnId: result.gatewayTxnId,
          idempotencyKey: crypto.randomUUID(),
        });
        if (result.status !== "captured") throw new GuestOrderError("Payment failed — please try again or ask a staff member.");

        await settleAndClose(tx, bill.id, session.tableSessionId);
        return { settled: true, payablePaise: bill.payable_paise };
      }

      let upiUrl: string | undefined;
      if (method === "upi_intent") {
        const outletResult = await tx.execute<{ [key: string]: unknown; upi_vpa: string | null; upi_payee_name: string | null }>(sql`
          select upi_vpa, upi_payee_name from outlets where id = ${session.outletId}
        `);
        const outlet = outletResult.rows[0];
        if (!outlet?.upi_vpa || !outlet.upi_payee_name) {
          throw new GuestOrderError("UPI isn't set up at this outlet yet — please pay by cash.");
        }
        upiUrl = buildUpiIntentUrl({
          vpa: outlet.upi_vpa,
          payeeName: outlet.upi_payee_name,
          amountPaise: payablePaise,
          note: bill.invoice_no ?? "Table bill",
        });
      }

      await tx.insert(schema.payments).values({
        id: crypto.randomUUID(),
        businessDate,
        billId: bill.id,
        outletId: session.outletId,
        storeId: session.storeId,
        method,
        amountPaise: payablePaise,
        status: "pending",
        idempotencyKey: crypto.randomUUID(),
      });

      return { settled: false, payablePaise: bill.payable_paise, ...(upiUrl ? { upiUrl } : {}) };
    }),
  );
}

/** Same rule as apps/pos's applySettleBill: captured sum >= payable settles
 *  the bill and closes the table. Shared by the guest mock-auto path here
 *  and POS's confirmGuestPayment (staff confirming a pending claim) —
 *  neither duplicates the other's copy of this check. */
export async function settleAndClose(tx: Tx, billId: string, tableSessionId: string): Promise<void> {
  const paidResult = await tx.execute<{ [key: string]: unknown; total: string }>(sql`
    select coalesce(sum(amount_paise), 0) as total from payments where bill_id = ${billId} and status = 'captured'
  `);
  const bill = (await tx.select().from(schema.bills).where(eq(schema.bills.id, billId)))[0];
  if (!bill) throw new GuestOrderError("Bill not found.");
  const totalPaid = BigInt(paidResult.rows[0]!.total);
  if (totalPaid < bill.payablePaise) return;

  await tx.update(schema.bills).set({ status: "settled" }).where(eq(schema.bills.id, billId));
  assertSessionTransition("settling", "closed");
  await tx.update(schema.tableSessions).set({ status: "closed", closedAt: new Date() }).where(eq(schema.tableSessions.id, tableSessionId));
}

/**
 * Feedback allows a session that's already 'closed' (the mock path) or
 * still 'settling' (the pending-claim path) — `allowClosed: true` is what
 * makes the former legal; `resolveOwnSession` already accepts 'settling'
 * by default since it isn't in ALWAYS_TERMINAL_STATUSES.
 */
export async function submitFeedback(rating: number, comment: string): Promise<Result<{ submitted: true }>> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "Please choose a rating from 1 to 5." };
  }

  const db = getDb();
  return asResult(() =>
    db.transaction(async (tx) => {
      const session = await resolveOwnSession(tx, { allowClosed: true });
      const businessDate = await getBusinessDate(tx, session.businessDayId);
      const trimmed = comment.trim();

      // unique(table_session_id, business_date) makes a second submit a
      // structural no-op rather than a duplicate row — check first so a
      // double-tap reads as "already saved," not a raw constraint error.
      const existing = await tx.execute<{ [key: string]: unknown; id: string }>(sql`
        select id from feedback where table_session_id = ${session.tableSessionId} and business_date = ${businessDate} limit 1
      `);
      if (existing.rows.length > 0) return { submitted: true as const };

      await tx.insert(schema.feedback).values({
        id: crypto.randomUUID(),
        businessDate,
        tableSessionId: session.tableSessionId,
        outletId: session.outletId,
        storeId: session.storeId,
        rating,
        comment: trimmed || null,
      });
      return { submitted: true as const };
    }),
  );
}
