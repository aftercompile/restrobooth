"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Badge, Button, Card, CardHeader, Input, Select, useToast, type ToastTone } from "@restrobooth/ui";
import { computeBill, type BillLineInput, type TaxRateInput } from "@restrobooth/domain";
import { getOfflineDb, type OutboxEntry } from "../../../../lib/offline/db";
import { enqueue, discardRejected } from "../../../../lib/offline/outbox";
import { uuid7 } from "../../../../lib/offline/uuid7";
import { useOnlineStatus } from "../../../../lib/offline/useOnlineStatus";
import { refundBill, splitBillByAmount, splitBillByItems, voidBill, type ActionState } from "./actions";
import type { BillPreview, ExistingBill } from "./queries";
import styles from "./page.module.css";

const INITIAL: ActionState = { error: null };

function formatRupees(paise: string | bigint): string {
  const n = typeof paise === "bigint" ? paise : BigInt(paise);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? "-" : ""}₹${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** Discarding a rejected outbox entry is a local IndexedDB delete (no
 *  network round trip), but still gets the same static disabled+label-swap
 *  treatment as every other button here for a consistent feel and to
 *  guard against a double click. */
function DiscardButton({ id, small }: { id: string; small?: boolean }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      className={small ? styles.smallButton : undefined}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await discardRejected(id);
      }}
    >
      {pending ? "Discarding…" : "Discard"}
    </Button>
  );
}

function sumLocalPaid(entries: OutboxEntry[]): bigint {
  return entries.reduce((sum, e) => {
    const amountRupees = (e.payload as { amountRupees: string }).amountRupees;
    return sum + BigInt(Math.round(Number(amountRupees) * 100));
  }, 0n);
}

export function BillView({ sessionId, preview, bills }: { sessionId: string; preview: BillPreview; bills: ExistingBill[] }) {
  const entries = useLiveQuery(() => getOfflineDb().outbox.where("sessionId").equals(sessionId).sortBy("createdAt"), [sessionId], [] as OutboxEntry[]) ?? [];
  const pendingFinalize = entries.find((e) => e.mutationType === "finalizeBill" && e.status !== "applied");
  const settlesByBill = new Map<string, OutboxEntry[]>();
  for (const e of entries) {
    if (e.mutationType !== "settleBill" || e.status === "applied") continue;
    const billId = (e.payload as { billId: string }).billId;
    const list = settlesByBill.get(billId) ?? [];
    list.push(e);
    settlesByBill.set(billId, list);
  }

  const activeBills = bills.filter((b) => b.status !== "voided");

  if (activeBills.length === 0 && !pendingFinalize) {
    return <FinalizeForm sessionId={sessionId} preview={preview} />;
  }

  return (
    <div className={styles.billList}>
      {pendingFinalize && activeBills.length === 0 && (
        <PendingFinalizeCard
          sessionId={sessionId}
          entry={pendingFinalize}
          localSettles={settlesByBill.get((pendingFinalize.payload as { billId: string }).billId) ?? []}
        />
      )}
      {activeBills.map((bill) => {
        if (bill.status === "finalised") {
          return <SettleView key={bill.billId} sessionId={sessionId} bill={bill} localSettles={settlesByBill.get(bill.billId) ?? []} />;
        }
        if (bill.status === "settled") return <SettledView key={bill.billId} sessionId={sessionId} bill={bill} />;
        return (
          <Card padded key={bill.billId}>
            <p>
              Invoice <strong>{bill.invoiceNo}</strong> — {bill.status}
            </p>
            <p className={styles.totalsRow}>
              <span>Payable</span>
              <span className={styles.lineAmount}>{formatRupees(bill.payablePaise)}</span>
            </p>
            <Link href={`/bill/${bill.billId}`}>View / print invoice</Link>
          </Card>
        );
      })}
    </div>
  );
}

type SplitMode = "one" | "items" | "amount";

function FinalizeForm({ sessionId, preview }: { sessionId: string; preview: BillPreview }) {
  const [mode, setMode] = useState<SplitMode>("one");

  return (
    <>
      <Card padded={false}>
        <CardHeader title="Bill preview" count={preview.lines.length} />
        {preview.lines.map((l) => (
          <div key={l.orderItemId} className={styles.lineRow}>
            <span className={styles.lineName}>
              {l.quantity}× {l.name}
            </span>
            <span className={styles.lineAmount}>{formatRupees(BigInt(l.unitPricePaise) * BigInt(l.quantity))}</span>
          </div>
        ))}

        <div className={styles.totalsRow}>
          <span>Subtotal</span>
          <span className={styles.lineAmount}>{formatRupees(preview.computed.subtotalPaise)}</span>
        </div>
        {preview.computed.billDiscountPaise > 0n && (
          <div className={styles.totalsRow}>
            <span>Discount</span>
            <span className={styles.lineAmount}>-{formatRupees(preview.computed.billDiscountPaise)}</span>
          </div>
        )}
        {preview.computed.chargesPaise > 0n && (
          <div className={styles.totalsRow}>
            <span>Service charge</span>
            <span className={styles.lineAmount}>{formatRupees(preview.computed.chargesPaise)}</span>
          </div>
        )}
        <div className={styles.totalsRow}>
          <span>Tax</span>
          <span className={styles.lineAmount}>{formatRupees(preview.computed.taxTotalPaise)}</span>
        </div>
        <div className={`${styles.totalsRow} ${styles.grand}`}>
          <span>Payable</span>
          <span className={styles.lineAmount}>{formatRupees(preview.computed.payablePaise)}</span>
        </div>
      </Card>

      <div className={styles.modeTabs}>
        <Button type="button" variant={mode === "one" ? "primary" : "secondary"} onClick={() => setMode("one")}>
          One bill
        </Button>
        <Button type="button" variant={mode === "items" ? "primary" : "secondary"} onClick={() => setMode("items")} disabled={preview.lines.length === 0}>
          Split by item/guest
        </Button>
        <Button type="button" variant={mode === "amount" ? "primary" : "secondary"} onClick={() => setMode("amount")} disabled={preview.lines.length === 0}>
          Split by amount
        </Button>
      </div>

      {mode === "one" && <OneBillControls sessionId={sessionId} preview={preview} />}
      {mode === "items" && <SplitByItemsControls sessionId={sessionId} preview={preview} />}
      {mode === "amount" && <SplitByAmountControls sessionId={sessionId} />}
    </>
  );
}

/**
 * ADR-0004: writes to the local outbox and returns instantly — no network
 * wait, online or off. The payable/tax figures shown immediately after are
 * computed HERE with packages/domain's own `computeBill()` (the exact
 * function the server runs), using the tax rates already carried on
 * `preview.lines` — "the same money math runs on the terminal and on the
 * server," not a guess. The server still recomputes independently and its
 * answer is what actually gets stored; a disagreement would be a bug, not
 * a routine reconciliation, and this pass doesn't yet wire an alarm for
 * that case (see PROGRESS.md).
 */
function OneBillControls({ sessionId, preview }: { sessionId: string; preview: BillPreview }) {
  const toast = useToast();
  const [discountKind, setDiscountKind] = useState<"none" | "flat" | "percent">("none");
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const discountValue = String(formData.get("discountValue") ?? "0");
      const serviceChargeBps = Number(formData.get("serviceChargeBps") ?? 0);

      const billDiscount =
        discountKind === "flat"
          ? { kind: "flat" as const, amountPaise: BigInt(Math.round(Number(discountValue) * 100)) }
          : discountKind === "percent"
            ? { kind: "percent" as const, bps: Math.round(Number(discountValue) * 100) }
            : undefined;

      const lines: BillLineInput[] = preview.lines.map((l) => ({
        id: l.orderItemId,
        grossPaise: BigInt(l.unitPricePaise) * BigInt(l.quantity),
        taxClassId: l.taxClassId,
      }));
      const taxRates: TaxRateInput[] = Array.from(new Map(preview.lines.map((l) => [l.taxClassId, l.taxRateBps])).entries()).map(
        ([taxClassId, rateBps]) => ({ taxClassId, rateBps }),
      );
      const subtotalPaise = lines.reduce((sum, l) => sum + l.grossPaise, 0n);
      const charges =
        serviceChargeBps > 0
          ? [{ name: "service_charge", taxClassId: taxRates[0]!.taxClassId, amountPaise: (subtotalPaise * BigInt(serviceChargeBps)) / 10_000n }]
          : [];

      const local = computeBill({
        lines,
        taxRates,
        ...(billDiscount !== undefined ? { billDiscount } : {}),
        charges,
        isIntraState: true,
      });

      const billId = uuid7();
      await enqueue(
        "finalizeBill",
        sessionId,
        { sessionId, billId, discountKind, discountValue, serviceChargeBps },
        { billId, subtotalPaise: local.subtotalPaise.toString(), taxTotalPaise: local.taxTotalPaise.toString(), payablePaise: local.payablePaise.toString() },
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not queue the bill.", "critical");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit}>
      <div className={styles.controls}>
        <Select
          label="Discount"
          name="discountKind"
          className={styles.narrowInput}
          value={discountKind}
          onChange={(e) => setDiscountKind(e.target.value as typeof discountKind)}
        >
          <option value="none">None</option>
          <option value="flat">Flat (₹)</option>
          <option value="percent">Percent (%)</option>
        </Select>
        {discountKind !== "none" && (
          <Input
            label={discountKind === "flat" ? "Amount (₹)" : "Percent (%)"}
            type="number"
            name="discountValue"
            step="0.01"
            min={0}
            className={styles.narrowInput}
          />
        )}
        <Input
          label="Service charge (%)"
          type="number"
          name="serviceChargeBps"
          step="1"
          min={0}
          defaultValue={0}
          className={styles.narrowInput}
        />
        <Button type="submit" variant="primary" disabled={pending || preview.lines.length === 0}>
          {pending ? "Finalising…" : "Finalise bill"}
        </Button>
      </div>
    </form>
  );
}

function SplitByItemsControls({ sessionId, preview }: { sessionId: string; preview: BillPreview }) {
  const [state, formAction, pending] = useActionState(splitBillByItems, INITIAL);
  const [guestCount, setGuestCount] = useState(2);
  // Every item defaults to guest 1 — the cashier moves/adds shares from there.
  const [assignments, setAssignments] = useState<Record<string, Set<number>>>(() =>
    Object.fromEntries(preview.lines.map((l) => [l.orderItemId, new Set([1])])),
  );

  function toggle(orderItemId: string, guest: number) {
    setAssignments((prev) => {
      const next = new Set(prev[orderItemId] ?? []);
      if (next.has(guest)) next.delete(guest);
      else next.add(guest);
      return { ...prev, [orderItemId]: next };
    });
  }

  const guests = Array.from({ length: guestCount }, (_, i) => i + 1);

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className={styles.controls}>
        <label>
          Guests
          <input
            type="number"
            min={2}
            max={12}
            value={guestCount}
            onChange={(e) => setGuestCount(Math.max(2, Math.min(12, Number(e.target.value) || 2)))}
            className={styles.narrowInput}
          />
        </label>
      </div>

      <Card padded={false}>
        <table className={styles.splitTable}>
          <thead>
            <tr>
              <th className={styles.splitItemHead}>Item</th>
              {guests.map((g) => (
                <th key={g}>G{g}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.lines.map((l) => (
              <tr key={l.orderItemId}>
                <td className={styles.splitItemHead}>
                  {l.quantity}× {l.name}
                </td>
                {guests.map((g) => (
                  <td key={g}>
                    <input
                      type="checkbox"
                      name={`share_${l.orderItemId}`}
                      value={g}
                      checked={assignments[l.orderItemId]?.has(g) ?? false}
                      onChange={() => toggle(l.orderItemId, g)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className={styles.controls}>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Splitting…" : "Split into checks"}
        </Button>
      </div>
      {state.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}

function SplitByAmountControls({ sessionId }: { sessionId: string }) {
  const [state, formAction, pending] = useActionState(splitBillByAmount, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className={styles.controls}>
        <label>
          Split into
          <input type="number" name="ways" min={2} max={12} defaultValue={2} className={styles.narrowInput} />
          equal ways
        </label>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Splitting…" : "Split evenly"}
        </Button>
      </div>
      {state.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}

/** Payment form shared by SettleView (real bill) and PendingFinalizeCard
 *  (bill still queued locally) — same dispatch, same offline rule (ADR-0004
 *  §5: card/UPI need the network; offline, only cash is offered). */
function PayForm({
  billId,
  sessionId,
  remainingPaise,
  toast,
}: {
  billId: string;
  sessionId: string;
  remainingPaise: bigint;
  toast: (message: string, tone?: ToastTone) => void;
}) {
  const online = useOnlineStatus();
  const [pending, setPending] = useState(false);

  async function handleSubmit(formData: FormData) {
    setPending(true);
    try {
      const method = String(formData.get("method") ?? "cash");
      const amountRupees = String(formData.get("amount") ?? "");
      await enqueue("settleBill", sessionId, { billId, sessionId, method, amountRupees });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not queue the payment.", "critical");
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={handleSubmit} className={styles.controls}>
      <label>
        Method
        <select name="method" className={styles.select} defaultValue="cash">
          <option value="cash">Cash</option>
          <option value="upi_intent" disabled={!online}>
            UPI{!online ? " (needs network)" : ""}
          </option>
          <option value="card" disabled={!online}>
            Card{!online ? " (needs network)" : ""}
          </option>
          <option value="netbanking" disabled={!online}>
            Netbanking{!online ? " (needs network)" : ""}
          </option>
          <option value="wallet" disabled={!online}>
            Wallet{!online ? " (needs network)" : ""}
          </option>
        </select>
      </label>
      <input
        type="number"
        name="amount"
        step="0.01"
        min={0}
        defaultValue={(Number(remainingPaise) / 100).toFixed(2)}
        className={styles.narrowInput}
        aria-label="Payment amount"
      />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Recording…" : "Add payment"}
      </Button>
    </form>
  );
}

/** A bill that's been finalised locally but hasn't synced yet — no real
 *  `bills` row exists server-side for it. Figures come from the
 *  finalize outbox entry's `displayHint` (computed client-side by
 *  OneBillControls, same computeBill() the server runs). A cashier can
 *  still record payment against it (queued, drained once the finalize
 *  itself has applied — the outbox's FIFO order guarantees that ordering). */
function PendingFinalizeCard({ sessionId, entry, localSettles }: { sessionId: string; entry: OutboxEntry; localSettles: OutboxEntry[] }) {
  const toast = useToast();
  const billId = (entry.payload as { billId: string }).billId;
  const hint = entry.displayHint as { payablePaise?: string } | undefined;
  const payablePaise = hint?.payablePaise ? BigInt(hint.payablePaise) : 0n;
  const paidPaise = sumLocalPaid(localSettles);
  const remainingPaise = payablePaise - paidPaise;

  return (
    <Card padded>
      <p>
        Invoice <Badge tone={entry.status === "rejected" ? "critical" : "warning"}>{entry.status === "rejected" ? "sync failed" : "pending sync"}</Badge>
      </p>
      {entry.status === "rejected" && (
        <>
          <p className={styles.error}>{entry.errorMessage}</p>
          <DiscardButton id={entry.id} />
        </>
      )}
      {entry.status !== "rejected" && (
        <>
          {payablePaise > 0n && (
            <>
              <div className={styles.totalsRow}>
                <span>Payable (offline estimate)</span>
                <span className={styles.lineAmount}>{formatRupees(payablePaise)}</span>
              </div>
              <div className={styles.totalsRow}>
                <span>Paid so far</span>
                <span className={styles.lineAmount}>{formatRupees(paidPaise)}</span>
              </div>
              <div className={`${styles.totalsRow} ${styles.grand}`}>
                <span>Remaining</span>
                <span className={styles.lineAmount}>{formatRupees(remainingPaise)}</span>
              </div>
              {remainingPaise > 0n && <PayForm billId={billId} sessionId={sessionId} remainingPaise={remainingPaise} toast={toast} />}
            </>
          )}
        </>
      )}
    </Card>
  );
}

function SettleView({ sessionId, bill, localSettles }: { sessionId: string; bill: ExistingBill; localSettles: OutboxEntry[] }) {
  const toast = useToast();
  const [voidState, voidAction, voidPending] = useActionState(voidBill, INITIAL);

  const localPaid = sumLocalPaid(localSettles);
  const paidPaise = BigInt(bill.paidPaise) + localPaid;
  const payablePaise = BigInt(bill.payablePaise);
  const remainingPaise = payablePaise - paidPaise;
  const syncingCount = localSettles.filter((e) => e.status !== "rejected").length;
  const rejected = localSettles.filter((e) => e.status === "rejected");

  return (
    <Card padded>
      <p>
        Invoice <strong>{bill.invoiceNo}</strong>
      </p>
      <div className={styles.totalsRow}>
        <span>Payable</span>
        <span className={styles.lineAmount}>{formatRupees(payablePaise)}</span>
      </div>
      <div className={styles.totalsRow}>
        <span>
          Paid so far {syncingCount > 0 && <Badge tone="warning">{syncingCount} syncing</Badge>}
        </span>
        <span className={styles.lineAmount}>{formatRupees(paidPaise)}</span>
      </div>
      <div className={`${styles.totalsRow} ${styles.grand}`}>
        <span>Remaining</span>
        <span className={styles.lineAmount}>{formatRupees(remainingPaise)}</span>
      </div>
      {rejected.map((e) => (
        <p key={e.id} className={styles.error}>
          A queued payment failed to sync: {e.errorMessage}{" "}
          <DiscardButton id={e.id} small />
        </p>
      ))}

      {remainingPaise > 0n && <PayForm billId={bill.billId} sessionId={sessionId} remainingPaise={remainingPaise} toast={toast} />}

      <form action={voidAction}>
        <input type="hidden" name="billId" value={bill.billId} />
        <input type="hidden" name="sessionId" value={sessionId} />
        <Button type="submit" variant="danger" disabled={voidPending}>
          {voidPending ? "Voiding…" : "Void bill"}
        </Button>
        {voidState.error && <span className={styles.error}>{voidState.error}</span>}
      </form>

      {remainingPaise <= 0n && <Badge tone="live">settled</Badge>}
    </Card>
  );
}

const REFUND_REASONS = [
  { value: "guest_dispute", label: "Guest dispute" },
  { value: "billing_error", label: "Billing error" },
  { value: "duplicate_payment", label: "Duplicate payment" },
  { value: "goodwill_gesture", label: "Goodwill gesture" },
];

function SettledView({ sessionId, bill }: { sessionId: string; bill: ExistingBill }) {
  const [state, formAction, pending] = useActionState(refundBill, INITIAL);
  const [mode, setMode] = useState<"full" | "partial">("full");
  const [showRefund, setShowRefund] = useState(false);

  return (
    <Card padded>
      <p>
        Invoice <strong>{bill.invoiceNo}</strong> — settled
      </p>
      <div className={styles.totalsRow}>
        <span>Payable</span>
        <span className={styles.lineAmount}>{formatRupees(bill.payablePaise)}</span>
      </div>
      <div className={styles.controls}>
        <Link href={`/bill/${bill.billId}`}>View / print invoice</Link>
        <Button type="button" variant="secondary" onClick={() => setShowRefund((v) => !v)}>
          {showRefund ? "Cancel refund" : "Refund…"}
        </Button>
      </div>

      {showRefund && (
        <form action={formAction} className={styles.controls}>
          <input type="hidden" name="billId" value={bill.billId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <label>
            Amount
            <select name="mode" className={styles.select} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="full">Full refund</option>
              <option value="partial">Partial</option>
            </select>
          </label>
          {mode === "partial" && (
            <input type="number" name="amount" step="0.01" min={0} className={styles.narrowInput} placeholder="Amount ₹" />
          )}
          <label>
            Reason
            <select name="reasonCode" className={styles.select} defaultValue={REFUND_REASONS[0]!.value}>
              {REFUND_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <input type="text" name="note" placeholder="Note (optional)" className={styles.select} />
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? "Issuing…" : "Issue credit note"}
          </Button>
          {state.error && <p className={styles.error}>{state.error}</p>}
        </form>
      )}
    </Card>
  );
}
