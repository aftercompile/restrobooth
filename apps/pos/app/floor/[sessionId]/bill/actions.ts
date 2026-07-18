"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq, schema, sql, withIdempotency, type RlsTx } from "@restrobooth/db";
import { allocateLargestRemainder, assertSessionTransition, computeBill, financialYearFor, formatInvoiceNumber, splitByAmount, type BillLineInput, type TaxRateInput } from "@restrobooth/domain";
import { queryAsCurrentUser } from "../../../../lib/db";
import { computeBillPreview, getBillableLines, getBillableSession, type BillableLine, type BillableSession } from "./queries";

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
 * Split-bill (item/guest or amount) means a session can have several
 * independent bills in flight at once — the table isn't free until ALL
 * of them are resolved, and a single voided bill among several shouldn't
 * un-freeze the table while the others are still owed. Called after every
 * settle/void: a session with any 'finalised' bill left stays 'settling';
 * once none remain, it closes if at least one bill actually settled, or
 * returns to 'dining' if every bill was voided (nothing was ever paid).
 */
async function reconcileSessionAfterBillChange(tx: RlsTx, sessionId: string): Promise<void> {
  const tsRow = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
  if (!tsRow || tsRow.status !== "settling") return;

  const rows = await tx.select({ status: schema.bills.status }).from(schema.bills).where(eq(schema.bills.tableSessionId, sessionId));
  if (rows.some((r) => r.status === "finalised")) return;

  const settled = rows.some((r) => r.status === "settled" || r.status === "refunded_partial" || r.status === "refunded_full");
  if (settled) {
    assertSessionTransition("settling", "closed");
    await tx.update(schema.tableSessions).set({ status: "closed", closedAt: new Date() }).where(eq(schema.tableSessions.id, sessionId));
  } else {
    assertSessionTransition("settling", "dining");
    await tx.update(schema.tableSessions).set({ status: "dining" }).where(eq(schema.tableSessions.id, sessionId));
  }
}

/** Draws the next invoice number for this session's terminal/GSTIN/series —
 *  shared by finalizeBill and both split actions so there is one call site. */
async function drawInvoiceNumber(tx: RlsTx, session: BillableSession): Promise<string> {
  const fy = financialYearFor(session.businessDate);
  const seqResult = await tx.execute<{ [key: string]: unknown; seq: string }>(sql`
    select next_invoice_seq(${session.terminalId}, ${session.gstRegistrationId}, ${session.outletId}, ${DEFAULT_SERIES_CODE}, ${fy}) as seq
  `);
  const seq = BigInt(seqResult.rows[0]!.seq);
  return formatInvoiceNumber(DEFAULT_SERIES_CODE, fy, seq);
}

const CREDIT_NOTE_SERIES_CODE = "A1CN"; // DOMAIN.md §6.2's own worked example — a separate numbering universe from A1.

/** Draws the next credit-note number — its own series, own sequence,
 *  never reused, never mixed with the bill series it reverses. */
async function drawCreditNoteNumber(tx: RlsTx, session: BillableSession): Promise<string> {
  const fy = financialYearFor(session.businessDate);
  const seqResult = await tx.execute<{ [key: string]: unknown; seq: string }>(sql`
    select next_invoice_seq(${session.terminalId}, ${session.gstRegistrationId}, ${session.outletId}, ${CREDIT_NOTE_SERIES_CODE}, ${fy}) as seq
  `);
  const seq = BigInt(seqResult.rows[0]!.seq);
  return formatInvoiceNumber(CREDIT_NOTE_SERIES_CODE, fy, seq, 5);
}

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
export interface FinalizeBillInput {
  sessionId: string;
  billId: string;
  discountKind: string;
  discountValue: string;
  serviceChargeBps: number;
}

/**
 * ADR-0004: `billId` is client-generated so the offline drain's retry is a
 * genuine no-op (`withIdempotency`) and so the UI can navigate to the bill
 * screen before the server has confirmed anything. No FormData, no
 * redirect() — called by the offline outbox drain
 * (`lib/offline/outbox.ts`); `BillView.tsx` enqueues, it doesn't call
 * this directly.
 */
export async function applyFinalizeBill(idempotencyKey: string, input: FinalizeBillInput): Promise<{ billId: string }> {
  const { sessionId, billId, discountKind, discountValue, serviceChargeBps } = input;
  if (!sessionId || !billId) throw new Error("missing session or bill id");

  return queryAsCurrentUser(async (tx) => {
    const session = await getBillableSession(tx, sessionId);
    if (!session) throw new Error("session not found");

    const { result } = await withIdempotency(
      tx,
      { key: idempotencyKey, outletId: session.outletId, endpoint: "finalizeBill", requestBody: input },
      async () => {
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

        const invoiceNo = await drawInvoiceNumber(tx, session);

        await tx.insert(schema.bills).values({
          id: billId,
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
          idempotencyKey,
          finalisedAt: new Date(),
        });

        if (computed.taxLines.length > 0) {
          await tx.insert(schema.billTaxLines).values(
            computed.taxLines.map((t) => ({
              billId,
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
            billId,
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

        await freezeSessionForBilling(tx, sessionId, tsRow.status);

        return { billId };
      },
    );

    revalidatePath(`/floor/${sessionId}`);
    return result;
  });
}

/**
 * Split tender: one or more payments, `Σ amounts === bill.payable`
 * exactly (DOMAIN.md §7.4). Settling closes the table session — this is
 * the point a table actually frees up.
 */
export interface SettleBillInput {
  billId: string;
  sessionId: string;
  method: string;
  amountRupees: string;
}

/**
 * Split tender: one or more payments, `Σ amounts === bill.payable`
 * exactly (DOMAIN.md §7.4). Settling closes the table session — this is
 * the point a table actually frees up. ADR-0004 §5: card/UPI need the
 * network by definition and are simply not offered offline — the UI
 * layer enforces that (`SettleView`'s method picker), not this function.
 */
export async function applySettleBill(idempotencyKey: string, input: SettleBillInput): Promise<{ settled: boolean }> {
  const { billId, sessionId, method, amountRupees } = input;
  if (!billId || !sessionId) throw new Error("missing bill");

  const amountPaise = BigInt(Math.round(Number(amountRupees) * 100));
  if (!Number.isFinite(Number(amountRupees)) || amountPaise <= 0n) {
    throw new Error("payment amount must be positive");
  }

  return queryAsCurrentUser(async (tx) => {
    const bill = (await tx.select().from(schema.bills).where(eq(schema.bills.id, billId)))[0];
    if (!bill) throw new Error("bill not found");

    const { result } = await withIdempotency(
      tx,
      { key: idempotencyKey, outletId: bill.outletId, endpoint: "settleBill", requestBody: input },
      async () => {
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
          idempotencyKey,
        });

        const paidResult = await tx.execute<{ [key: string]: unknown; total: string }>(sql`
          select coalesce(sum(amount_paise), 0) as total from payments where bill_id = ${billId} and status = 'captured'
        `);
        const totalPaid = BigInt(paidResult.rows[0]!.total);

        let settled = false;
        if (totalPaid >= bill.payablePaise) {
          await tx.update(schema.bills).set({ status: "settled" }).where(eq(schema.bills.id, billId));
          await reconcileSessionAfterBillChange(tx, sessionId);
          settled = true;
        }
        return { settled };
      },
    );

    revalidatePath(`/floor/${sessionId}/bill`);
    return result;
  });
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
      // If this was the session's only bill, reconcile returns it to
      // dining (nothing was ever paid — "settling -> dining", the
      // DOMAIN.md un-freeze pattern added for this exact case). If other
      // bills from a split are still finalised or settled, it stays put.
      await reconcileSessionAfterBillChange(tx, sessionId);
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not void the bill." };
  }

  revalidatePath(`/floor/${sessionId}/bill`);
  return OK;
}

async function freezeSessionForBilling(tx: RlsTx, sessionId: string, currentStatus: string): Promise<void> {
  if (currentStatus === "dining") {
    assertSessionTransition("dining", "bill_requested");
    assertSessionTransition("bill_requested", "settling");
  } else {
    assertSessionTransition("bill_requested", "settling");
  }
  await tx.update(schema.tableSessions).set({ status: "settling" }).where(eq(schema.tableSessions.id, sessionId));
}

/**
 * Split by item/guest. DOMAIN.md §7.4: "split-by-item assigns whole
 * lines; split-by-guest additionally allows a line to be SHARED across
 * guests" — one order item checked for more than one guest is the shared
 * case. Deliberately does NOT call packages/domain's splitByShares(): that
 * function pools same-(sharer-set,tax-class) items together before
 * allocating, which is correct for the *figures* but throws away which
 * original order_item each paisa came from — and bill_lines (0020) needs
 * that traceability to reconcile exactly with what's shown. Allocating
 * per-item instead (via the same allocateLargestRemainder primitive) is
 * one legitimate choice among several correct ones — DOMAIN.md's own text
 * says split totals don't have to reconcile to a hypothetical un-split
 * bill, only each share's own bill has to be internally correct, which
 * this is by construction (bill_lines ARE the computeBill() input).
 */
export async function splitBillByItems(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return { error: "Missing session." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const session = await getBillableSession(tx, sessionId);
      if (!session) throw new Error("session not found");
      const tsRow = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
      if (!tsRow) throw new Error("session not found");
      if (tsRow.status !== "dining" && tsRow.status !== "bill_requested") {
        throw new Error(`cannot split a bill — session is '${tsRow.status}'`);
      }

      const lines = await getBillableLines(tx, sessionId);
      if (lines.length === 0) throw new Error("nothing to bill — no fired or served items on this session");

      type GuestLine = { name: string; quantity: number; unitPricePaise: bigint; taxClassId: string };
      const computeLinesByGuest = new Map<string, BillLineInput[]>();
      const snapshotLinesByGuest = new Map<string, { orderItemId: string; line: GuestLine }[]>();

      for (const l of lines) {
        const guestIds = formData.getAll(`share_${l.orderItemId}`).map(String);
        if (guestIds.length === 0) throw new Error(`"${l.name}" has no guest assigned — every item must go to at least one guest`);
        const grossPaise = BigInt(l.unitPricePaise) * BigInt(l.quantity);

        if (guestIds.length === 1) {
          const guestId = guestIds[0]!;
          if (!computeLinesByGuest.has(guestId)) {
            computeLinesByGuest.set(guestId, []);
            snapshotLinesByGuest.set(guestId, []);
          }
          computeLinesByGuest.get(guestId)!.push({ id: l.orderItemId, grossPaise, taxClassId: l.taxClassId });
          snapshotLinesByGuest.get(guestId)!.push({
            orderItemId: l.orderItemId,
            line: { name: l.name, quantity: l.quantity, unitPricePaise: BigInt(l.unitPricePaise), taxClassId: l.taxClassId },
          });
        } else {
          const allocations = allocateLargestRemainder(grossPaise, guestIds.map(() => 1n));
          guestIds.forEach((guestId, i) => {
            if (!computeLinesByGuest.has(guestId)) {
              computeLinesByGuest.set(guestId, []);
              snapshotLinesByGuest.set(guestId, []);
            }
            computeLinesByGuest.get(guestId)!.push({ id: `${l.orderItemId}:${guestId}`, grossPaise: allocations[i]!, taxClassId: l.taxClassId });
            snapshotLinesByGuest.get(guestId)!.push({
              orderItemId: l.orderItemId,
              line: { name: `${l.name} (shared ×${guestIds.length})`, quantity: 1, unitPricePaise: allocations[i]!, taxClassId: l.taxClassId },
            });
          });
        }
      }

      if (computeLinesByGuest.size < 2) throw new Error("split needs items assigned to at least 2 different guests");

      const taxRates: TaxRateInput[] = Array.from(new Map(lines.map((l) => [l.taxClassId, l.taxRateBps])).entries()).map(
        ([taxClassId, rateBps]) => ({ taxClassId, rateBps }),
      );

      for (const [guestId, guestLines] of computeLinesByGuest) {
        const computed = computeBill({ lines: guestLines, taxRates, isIntraState: true });
        const invoiceNo = await drawInvoiceNumber(tx, session);
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

        await tx.insert(schema.billLines).values(
          snapshotLinesByGuest.get(guestId)!.map((s) => ({
            id: crypto.randomUUID(),
            businessDate: session.businessDate,
            billId: newBillId,
            outletId: session.outletId,
            storeId: session.storeId,
            orderItemId: s.orderItemId,
            name: s.line.name,
            quantity: s.line.quantity,
            unitPricePaise: s.line.unitPricePaise,
            taxClassId: s.line.taxClassId,
            taxRateBps: taxRates.find((r) => r.taxClassId === s.line.taxClassId)!.rateBps,
          })),
        );
      }

      await freezeSessionForBilling(tx, sessionId, tsRow.status);
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not split the bill." };
  }

  revalidatePath(`/floor/${sessionId}`);
  redirect(`/floor/${sessionId}/bill`);
}

/**
 * Split by amount — DOMAIN.md §7.4's other mechanism: N equal shares of
 * the SAME already-computed bill (packages/domain's splitByAmount, one
 * weight vector applied consistently to every figure). There is no
 * natural per-item attribution for an amount split (that's the whole
 * point — it's for "just divide the check evenly," not itemised), so each
 * share's bill_lines is a single synthetic summary line rather than a
 * subset of real order items. Anchored to the session's first billable
 * order_item purely to satisfy bill_lines' FK — it is not that item.
 */
export async function splitBillByAmount(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const sessionId = String(formData.get("sessionId") ?? "");
  const ways = Number(formData.get("ways") ?? 0);
  if (!sessionId) return { error: "Missing session." };
  if (!Number.isInteger(ways) || ways < 2) return { error: "Need at least 2 ways to split." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const session = await getBillableSession(tx, sessionId);
      if (!session) throw new Error("session not found");
      const tsRow = (await tx.select().from(schema.tableSessions).where(eq(schema.tableSessions.id, sessionId)))[0];
      if (!tsRow) throw new Error("session not found");
      if (tsRow.status !== "dining" && tsRow.status !== "bill_requested") {
        throw new Error(`cannot split a bill — session is '${tsRow.status}'`);
      }

      const { lines, computed } = await computeBillPreview(tx, sessionId);
      if (lines.length === 0) throw new Error("nothing to bill — no fired or served items on this session");
      const anchor: BillableLine = lines[0]!;

      const weights = Array.from({ length: ways }, () => 1n);
      const shares = splitByAmount(
        computed,
        weights.map((weight, i) => ({ shareId: String(i + 1), weight })),
      );
      // bills.payable_paise must be a whole rupee (payable_is_whole_rupees).
      // splitByAmount()'s own payableShares allocates in raw paise, which
      // for most `ways` values does NOT land on rupee boundaries — so it
      // is not used here. Allocating in rupees first and scaling back to
      // paise guarantees every share is a legal payable amount.
      const payableRupeeShares = allocateLargestRemainder(computed.payablePaise / 100n, weights);

      for (const [i, share] of shares.entries()) {
        const invoiceNo = await drawInvoiceNumber(tx, session);
        const newBillId = crypto.randomUUID();
        const payablePaise = payableRupeeShares[i]! * 100n;

        // The rupee-rounded payable and the independently-allocated
        // subtotal/tax don't land on the same figure by construction —
        // round_off_paise is exactly the field that reconciles them;
        // totals_reconcile requires it.
        const roundOffPaise = payablePaise - (share.subtotalPaise - share.billDiscountPaise + share.chargesPaise + share.taxTotalPaise);

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
          subtotalPaise: share.subtotalPaise,
          discountPaise: share.billDiscountPaise,
          chargesPaise: share.chargesPaise,
          taxPaise: share.taxTotalPaise,
          roundOffPaise,
          payablePaise,
          idempotencyKey: crypto.randomUUID(),
          finalisedAt: new Date(),
        });

        if (share.taxLines.length > 0) {
          await tx.insert(schema.billTaxLines).values(
            share.taxLines.map((t) => ({
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

        await tx.insert(schema.billLines).values([
          {
            id: crypto.randomUUID(),
            businessDate: session.businessDate,
            billId: newBillId,
            outletId: session.outletId,
            storeId: session.storeId,
            orderItemId: anchor.orderItemId,
            name: `Bill share ${i + 1} of ${ways}`,
            quantity: 1,
            unitPricePaise: share.subtotalPaise,
            taxClassId: anchor.taxClassId,
            taxRateBps: anchor.taxRateBps,
          },
        ]);
      }

      await freezeSessionForBilling(tx, sessionId, tsRow.status);
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not split the bill." };
  }

  revalidatePath(`/floor/${sessionId}`);
  redirect(`/floor/${sessionId}/bill`);
}

/**
 * DOMAIN.md §3.4: a SETTLED bill is never edited or un-settled — reversing
 * it issues a credit note (its own series, §6.2) and moves the bill to
 * refunded_partial/refunded_full. The original invoice's number and
 * content never change; this is the ONLY path to correct a paid bill.
 * Manager-gated at the DB (drizzle/0021's credit_note_issue_capability +
 * bill_void_refund_capability, both keyed on can_manage_business_day) —
 * not just hidden in the UI.
 */
export async function refundBill(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const billId = String(formData.get("billId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  const mode = String(formData.get("mode") ?? "full");
  const amountRupees = String(formData.get("amount") ?? "");
  const reasonCode = String(formData.get("reasonCode") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!billId || !sessionId) return { error: "Missing bill." };
  if (!reasonCode) return { error: "A reason is required." };

  try {
    await queryAsCurrentUser(async (tx, userId) => {
      const session = await getBillableSession(tx, sessionId);
      if (!session) throw new Error("session not found");
      const bill = (await tx.select().from(schema.bills).where(eq(schema.bills.id, billId)))[0];
      if (!bill) throw new Error("bill not found");
      if (bill.status !== "settled") throw new Error(`cannot refund — bill is '${bill.status}' (only a settled bill can be refunded)`);

      const amountPaise = mode === "full" ? bill.payablePaise : BigInt(Math.round(Number(amountRupees) * 100));
      if (mode === "partial" && (!Number.isFinite(Number(amountRupees)) || amountPaise <= 0n)) {
        throw new Error("refund amount must be positive");
      }
      if (amountPaise > bill.payablePaise) throw new Error("refund amount cannot exceed the bill's payable amount");

      const newStatus = amountPaise === bill.payablePaise ? "refunded_full" : "refunded_partial";
      await tx.update(schema.bills).set({ status: newStatus }).where(eq(schema.bills.id, billId));

      const creditNoteNo = await drawCreditNoteNumber(tx, session);
      await tx.insert(schema.creditNotes).values({
        id: crypto.randomUUID(),
        businessDate: bill.businessDate,
        billId,
        outletId: bill.outletId,
        storeId: bill.storeId,
        gstRegistrationId: bill.gstRegistrationId,
        terminalId: bill.terminalId,
        creditNoteNo,
        reasonCode,
        ...(note !== "" ? { note } : {}),
        amountPaise,
        issuedBy: userId,
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not issue the refund." };
  }

  revalidatePath(`/floor/${sessionId}/bill`);
  return OK;
}
