"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, schema, sql } from "@restrobooth/db";
import { assertSessionTransition, financialYearFor, formatInvoiceNumber } from "@restrobooth/domain";
import { queryAsCurrentUser } from "../../../../lib/db";
import { computeBillPreview, getBillableLines, getBillableSession } from "./queries";

export type ActionState = { error: string | null };
const OK: ActionState = { error: null };

/** See apps/pos's other actions.ts files — same fix. */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

const DEFAULT_SERIES_CODE = "A1"; // matches the seed's own convention — see queries.ts's header note.

/**
 * DOMAIN.md §3.4: the invoice number is assigned at finalise, not before —
 * a discarded draft burns no number. Computes via the exact same
 * computeBill() the live preview uses (no second implementation to
 * drift), draws the number from next_invoice_seq() (drizzle/0016 — the
 * terminal's own reserved block, online or offline, same call either
 * way), and freezes the session for billing (dining/bill_requested ->
 * settling — chaining through bill_requested if a captain never
 * explicitly asked for the bill first, since a cashier finalising IS that
 * ask when nobody else made it).
 */
export async function finalizeBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const discountKind = String(formData.get("discountKind") ?? "none");
  const discountValue = String(formData.get("discountValue") ?? "0");
  const serviceChargeBps = Number(formData.get("serviceChargeBps") ?? 0);
  if (!sessionId) return { error: "Missing session." };

  let billId: string;
  try {
    billId = await queryAsCurrentUser(async (tx) => {
      const session = await getBillableSession(tx, sessionId);
      if (!session) throw new Error("session not found");

      const tsRow = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
      if (!tsRow) throw new Error("session not found");
      if (tsRow.status !== "dining" && tsRow.status !== "bill_requested") {
        throw new Error(`cannot finalise a bill — session is '${tsRow.status}'`);
      }

      const billDiscount =
        discountKind === "flat"
          ? { kind: "flat" as const, amountPaise: BigInt(Math.round(Number(discountValue) * 100)) }
          : discountKind === "percent"
            ? { kind: "percent" as const, bps: Math.round(Number(discountValue) * 100) }
            : undefined;

      const { computed } = await computeBillPreview(tx, sessionId, {
        ...(billDiscount !== undefined ? { billDiscount } : {}),
        serviceChargeBps,
      });
      if (computed.lines.length === 0) throw new Error("nothing to bill — no fired or served items on this session");

      const fy = financialYearFor(session.businessDate);
      const seqResult = await tx.execute<{ [key: string]: unknown; seq: string }>(sql`
        select next_invoice_seq(${session.terminalId}, ${session.gstRegistrationId}, ${session.outletId}, ${DEFAULT_SERIES_CODE}, ${fy}) as seq
      `);
      const seq = BigInt(seqResult.rows[0]!.seq);
      const invoiceNo = formatInvoiceNumber(DEFAULT_SERIES_CODE, fy, seq);

      const newBillId = crypto.randomUUID();
      await tx.insert(schema.bills).values({
        id: newBillId,
        businessDate: session.businessDate,
        outletId: session.outletId,
        storeId: session.storeId,
        gstRegistrationId: session.gstRegistrationId,
        terminalId: session.terminalId,
        tableSessionId: sessionId,
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
            billId: newBillId,
            businessDate: session.businessDate,
            outletId: session.outletId,
            taxClassId: t.taxClassId,
            component: t.component,
            taxablePaise: t.taxablePaise,
            rateBps: t.rateBps,
            amountPaise: t.amountPaise,
          })),
        );
      }

      // Snapshot which order_items this bill covers, and what they were
      // named/priced at billing time — see 0020's header note.
      const billableLines = await getBillableLines(tx, sessionId);
      await tx.insert(schema.billLines).values(
        billableLines.map((l) => ({
          id: crypto.randomUUID(),
          businessDate: session.businessDate,
          billId: newBillId,
          outletId: session.outletId,
          storeId: session.storeId,
          orderItemId: l.orderItemId,
          name: l.name,
          quantity: l.quantity,
          unitPricePaise: BigInt(l.unitPricePaise),
          taxClassId: l.taxClassId,
          taxRateBps: l.taxRateBps,
        })),
      );

      if (tsRow.status === "dining") {
        assertSessionTransition("dining", "bill_requested");
        assertSessionTransition("bill_requested", "settling");
      } else {
        assertSessionTransition("bill_requested", "settling");
      }
      await tx.update(schema.tableSessions).set({ status: "settling" }).where(eq(schema.tableSessions.id, sessionId));

      return newBillId;
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not finalise the bill." };
  }

  revalidatePath(`/floor/${sessionId}`);
  redirect(`/floor/${sessionId}/bill?billId=${billId}`);
}

/**
 * Split tender: one or more payments, `Σ amounts === bill.payable`
 * exactly (DOMAIN.md §7.4). Settling closes the table session — this is
 * the point a table actually frees up.
 */
export async function settleBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const billId = String(formData.get("billId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const method = String(formData.get("method") ?? "cash");
  const amountRupees = String(formData.get("amount") ?? "");
  if (!billId || !sessionId) return { error: "Missing bill." };

  const amountPaise = BigInt(Math.round(Number(amountRupees) * 100));
  if (!Number.isFinite(Number(amountRupees)) || amountPaise <= 0n) {
    return { error: "Payment amount must be positive." };
  }

  try {
    await queryAsCurrentUser(async (tx) => {
      const bill = (await tx.select().from(schema.bills).where(eq(schema.bills.id, billId)))[0];
      if (!bill) throw new Error("bill not found");
      if (bill.status !== "finalised") throw new Error(`cannot settle — bill is '${bill.status}'`);

      await tx.insert(schema.payments).values({
        id: crypto.randomUUID(),
        businessDate: bill.businessDate,
        billId,
        outletId: bill.outletId,
        storeId: bill.storeId,
        method,
        amountPaise,
        status: "captured",
        idempotencyKey: crypto.randomUUID(),
      });

      const paidResult = await tx.execute<{ [key: string]: unknown; total: string }>(sql`
        select coalesce(sum(amount_paise), 0) as total from payments where bill_id = ${billId} and status = 'captured'
      `);
      const totalPaid = BigInt(paidResult.rows[0]!.total);

      if (totalPaid >= bill.payablePaise) {
        await tx.update(schema.bills).set({ status: "settled" }).where(eq(schema.bills.id, billId));
        assertSessionTransition("settling", "closed");
        await tx.update(schema.tableSessions).set({ status: "closed", closedAt: new Date() }).where(eq(schema.tableSessions.id, sessionId));
      }
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not record the payment." };
  }

  revalidatePath(`/floor/${sessionId}/bill`);
  return OK;
}

/** A finalised-but-unsettled bill voids directly — no payment was ever
 *  taken, so no credit note is needed. Manager-gated (drizzle/0016's
 *  bill_void_refund_capability). */
export async function voidBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const billId = String(formData.get("billId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!billId || !sessionId) return { error: "Missing bill." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const bill = (await tx.select().from(schema.bills).where(eq(schema.bills.id, billId)))[0];
      if (!bill) throw new Error("bill not found");
      if (bill.status !== "finalised") throw new Error(`cannot void — bill is '${bill.status}' (only a finalised, unsettled bill can be voided directly)`);

      await tx.update(schema.bills).set({ status: "voided" }).where(eq(schema.bills.id, billId));
      // The table session returns to dining — the party is still there,
      // the bill just needs re-doing. "settling -> dining" (packages/domain,
      // added for this exact case) is the DOMAIN.md un-freeze pattern one
      // step later than "bill_requested -> dining".
      assertSessionTransition("settling", "dining");
      await tx.update(schema.tableSessions).set({ status: "dining" }).where(eq(schema.tableSessions.id, sessionId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not void the bill." };
  }

  revalidatePath(`/floor/${sessionId}/bill`);
  return OK;
}
