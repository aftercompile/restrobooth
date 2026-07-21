"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Badge,
  BankIcon,
  Button,
  CardIcon,
  CashIcon,
  Card,
  CardHeader,
  CheckCircleIcon,
  Input,
  MoneyInput,
  ReceiptIcon,
  Select,
  SmartphoneIcon,
  WalletIcon,
  formatPaiseAsRupees,
  useToast,
  type ToastTone,
} from "@restrobooth/ui";
import { computeBill, type BillLineInput, type TaxRateInput } from "@restrobooth/domain";
import { getOfflineDb, type OutboxEntry } from "../../../../lib/offline/db";
import { enqueue, discardRejected } from "../../../../lib/offline/outbox";
import { uuid7 } from "../../../../lib/offline/uuid7";
import { useOnlineStatus } from "../../../../lib/offline/useOnlineStatus";
import { confirmGuestPayment, refundBill, splitBillByAmount, splitBillByItems, voidBill, type ActionState } from "./actions";
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

/** The invoice header every bill state (preview aside) shares — a small
 *  icon badge + invoice number, replacing a bare "Invoice X" text line. */
function BillHead({ invoiceNo, meta }: { invoiceNo: string; meta: string }) {
  return (
    <div className={styles.billHead}>
      <span className={styles.billHeadIconWrap}>
        <ReceiptIcon className={styles.billHeadIcon} />
      </span>
      <div>
        <div className={styles.billHeadInvoice}>{invoiceNo}</div>
        <div className={styles.billHeadMeta}>{meta}</div>
      </div>
    </div>
  );
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
            <BillHead invoiceNo={bill.invoiceNo ?? "—"} meta={bill.status} />
            <div className={styles.totalsRow}>
              <span>Payable</span>
              <span className={styles.lineAmount}>{formatRupees(bill.payablePaise)}</span>
            </div>
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

      <div className={styles.segmented} role="tablist" aria-label="How to bill this table">
        <button type="button" role="tab" aria-selected={mode === "one"} className={styles.segmentedButton} data-selected={mode === "one"} onClick={() => setMode("one")}>
          One bill
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "items"}
          className={styles.segmentedButton}
          data-selected={mode === "items"}
          disabled={preview.lines.length === 0}
          onClick={() => setMode("items")}
        >
          Split by item/guest
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "amount"}
          className={styles.segmentedButton}
          data-selected={mode === "amount"}
          disabled={preview.lines.length === 0}
          onClick={() => setMode("amount")}
        >
          Split by amount
        </button>
      </div>

      {mode === "one" && <OneBillControls sessionId={sessionId} preview={preview} />}
      {mode === "items" && <SplitByItemsControls sessionId={sessionId} preview={preview} />}
      {mode === "amount" && <SplitByAmountControls sessionId={sessionId} />}
    </>
  );
}

type DiscountKind = "none" | "flat" | "percent";

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
  const [discountKind, setDiscountKind] = useState<DiscountKind>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [serviceChargeBps, setServiceChargeBps] = useState("0");
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    setPending(true);
    try {
      const serviceChargeBpsNum = Number(serviceChargeBps) || 0;

      const billDiscount =
        discountKind === "flat"
          ? { kind: "flat" as const, amountPaise: BigInt(Math.round(Number(discountValue || 0) * 100)) }
          : discountKind === "percent"
            ? { kind: "percent" as const, bps: Math.round(Number(discountValue || 0) * 100) }
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
        serviceChargeBpsNum > 0
          ? [{ name: "service_charge", taxClassId: taxRates[0]!.taxClassId, amountPaise: (subtotalPaise * BigInt(serviceChargeBpsNum)) / 10_000n }]
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
        { sessionId, billId, discountKind, discountValue: discountValue || "0", serviceChargeBps: serviceChargeBpsNum },
        { billId, subtotalPaise: local.subtotalPaise.toString(), taxTotalPaise: local.taxTotalPaise.toString(), payablePaise: local.payablePaise.toString() },
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not queue the bill.", "critical");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card padded>
      <div className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Discount</span>
        <div className={styles.segmented}>
          <button type="button" className={styles.segmentedButton} data-selected={discountKind === "none"} onClick={() => setDiscountKind("none")}>
            None
          </button>
          <button type="button" className={styles.segmentedButton} data-selected={discountKind === "flat"} onClick={() => setDiscountKind("flat")}>
            Flat ₹
          </button>
          <button type="button" className={styles.segmentedButton} data-selected={discountKind === "percent"} onClick={() => setDiscountKind("percent")}>
            Percent %
          </button>
        </div>
      </div>

      <div className={styles.controls}>
        {discountKind !== "none" && (
          <Input
            label={discountKind === "flat" ? "Amount (₹)" : "Percent (%)"}
            type="number"
            step="0.01"
            min={0}
            className={styles.narrowInput}
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
          />
        )}
        <Input
          label="Service charge (%)"
          type="number"
          step="1"
          min={0}
          className={styles.narrowInput}
          value={serviceChargeBps}
          onChange={(e) => setServiceChargeBps(e.target.value)}
        />
        <Button type="button" variant="primary" disabled={pending || preview.lines.length === 0} onClick={handleSubmit}>
          {pending ? "Finalising…" : "Finalise bill"}
        </Button>
      </div>
    </Card>
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
        <Input
          label="Guests"
          type="number"
          min={2}
          max={12}
          value={guestCount}
          onChange={(e) => setGuestCount(Math.max(2, Math.min(12, Number(e.target.value) || 2)))}
          className={styles.narrowInput}
        />
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
        <Input label="Split into (equal ways)" type="number" name="ways" min={2} max={12} defaultValue={2} className={styles.narrowInput} />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Splitting…" : "Split evenly"}
        </Button>
      </div>
      {state.error && <p className={styles.error}>{state.error}</p>}
    </form>
  );
}

const METHODS = [
  { value: "cash", label: "Cash", icon: CashIcon, needsNetwork: false },
  { value: "upi_intent", label: "UPI", icon: SmartphoneIcon, needsNetwork: true },
  { value: "card", label: "Card", icon: CardIcon, needsNetwork: true },
  { value: "netbanking", label: "Netbanking", icon: BankIcon, needsNetwork: true },
  { value: "wallet", label: "Wallet", icon: WalletIcon, needsNetwork: true },
] as const;

/** Payment form shared by SettleView (real bill) and PendingFinalizeCard
 *  (bill still queued locally) — same dispatch, same offline rule (ADR-0004
 *  §5: card/UPI need the network; offline, only cash is offered). Tappable
 *  method buttons, not a dropdown — a cashier picking a tender under time
 *  pressure taps a visible choice rather than opening a native <select>. */
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
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("cash");
  const [amountPaise, setAmountPaise] = useState<bigint | null>(remainingPaise);

  async function handleSubmit() {
    if (amountPaise === null || amountPaise <= 0n) {
      toast("Enter a valid payment amount.", "critical");
      return;
    }
    setPending(true);
    try {
      await enqueue("settleBill", sessionId, { billId, sessionId, method, amountRupees: formatPaiseAsRupees(amountPaise) });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not queue the payment.", "critical");
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <span className={styles.fieldLabel}>Method</span>
      <div className={styles.methodGrid}>
        {METHODS.map((m) => {
          const disabled = m.needsNetwork && !online;
          return (
            <button
              key={m.value}
              type="button"
              className={styles.methodButton}
              data-selected={method === m.value}
              disabled={disabled}
              onClick={() => setMethod(m.value)}
            >
              <m.icon className={styles.methodIcon} />
              {m.label}
              {disabled && <span className={styles.methodHint}>Needs network</span>}
            </button>
          );
        })}
      </div>
      <div className={styles.payRow}>
        <MoneyInput label="Amount" valuePaise={amountPaise} onChangePaise={setAmountPaise} />
        <Button type="button" variant="primary" disabled={pending} onClick={handleSubmit}>
          {pending ? "Recording…" : "Add payment"}
        </Button>
      </div>
    </div>
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
      <div className={styles.billHead}>
        <span className={styles.billHeadIconWrap}>
          <ReceiptIcon className={styles.billHeadIcon} />
        </span>
        <Badge tone={entry.status === "rejected" ? "critical" : "warning"}>{entry.status === "rejected" ? "sync failed" : "pending sync"}</Badge>
      </div>
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

const METHOD_LABEL: Record<string, string> = { cash: "Cash", upi_intent: "UPI" };

/** ADR-0010 — a guest claims to have paid (cash or the UPI deep link);
 *  this confirms the cashier actually has the money/credit before it
 *  counts toward the bill. No offline outbox involved — a cashier
 *  confirming receipt is real-time by nature (they're looking at the cash
 *  or their banking app right now), same reasoning apps/pos's
 *  acknowledgeWaiterCall already established for other non-money, staff
 *  RLS-scoped floor actions. */
function PendingGuestPaymentRow({ sessionId, paymentId, method, amountPaise }: { sessionId: string; paymentId: string; method: string; amountPaise: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await confirmGuestPayment(paymentId, sessionId);
      if (result.error) toast(result.error, "critical");
    });
  }

  return (
    <div className={styles.guestClaimRow}>
      <div className={styles.guestClaimLabel}>
        <SmartphoneIcon className={styles.guestClaimIcon} />
        <span>
          Guest claims paid <Badge tone="warning">{METHOD_LABEL[method] ?? method}</Badge>
        </span>
      </div>
      <div className={styles.guestClaimAction}>
        <span className={styles.lineAmount}>{formatRupees(amountPaise)}</span>
        <Button type="button" variant="primary" className={styles.smallButton} disabled={pending} onClick={handleConfirm}>
          {pending ? "Confirming…" : "Confirm"}
        </Button>
      </div>
    </div>
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
      <BillHead invoiceNo={bill.invoiceNo ?? "—"} meta="Awaiting payment" />
      <div className={styles.totalsRow}>
        <span>Payable</span>
        <span className={styles.lineAmount}>{formatRupees(payablePaise)}</span>
      </div>
      {bill.pendingPayments.map((p) => (
        <PendingGuestPaymentRow key={p.paymentId} sessionId={sessionId} paymentId={p.paymentId} method={p.method} amountPaise={p.amountPaise} />
      ))}
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
          A queued payment failed to sync: {e.errorMessage} <DiscardButton id={e.id} small />
        </p>
      ))}

      {remainingPaise > 0n && <PayForm billId={bill.billId} sessionId={sessionId} remainingPaise={remainingPaise} toast={toast} />}

      <div className={styles.dangerRow}>
        <form action={voidAction}>
          <input type="hidden" name="billId" value={bill.billId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <Button type="submit" variant="danger" disabled={voidPending}>
            {voidPending ? "Voiding…" : "Void bill"}
          </Button>
          {voidState.error && <span className={styles.error}>{voidState.error}</span>}
        </form>
        {remainingPaise <= 0n && <Badge tone="live">settled</Badge>}
      </div>
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
      <div className={styles.billHead}>
        <span className={styles.billHeadIconWrap}>
          <CheckCircleIcon className={styles.billHeadIcon} />
        </span>
        <div>
          <div className={styles.billHeadInvoice}>{bill.invoiceNo}</div>
          <Badge tone="live">Settled</Badge>
        </div>
      </div>
      <div className={styles.totalsRow}>
        <span>Payable</span>
        <span className={styles.lineAmount}>{formatRupees(bill.payablePaise)}</span>
      </div>
      <div className={styles.controls}>
        <Link href={`/bill/${bill.billId}`} className={styles.invoiceLink}>
          <ReceiptIcon className={styles.smallIcon} />
          View / print invoice
        </Link>
        <Button type="button" variant="secondary" onClick={() => setShowRefund((v) => !v)}>
          {showRefund ? "Cancel refund" : "Refund…"}
        </Button>
      </div>

      {showRefund && (
        <form action={formAction}>
          <input type="hidden" name="billId" value={bill.billId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Amount</span>
            <div className={styles.segmented}>
              <button type="button" className={styles.segmentedButton} data-selected={mode === "full"} onClick={() => setMode("full")}>
                Full refund
              </button>
              <button type="button" className={styles.segmentedButton} data-selected={mode === "partial"} onClick={() => setMode("partial")}>
                Partial
              </button>
            </div>
            <input type="hidden" name="mode" value={mode} />
          </div>
          <div className={styles.controls}>
            {mode === "partial" && <Input label="Amount (₹)" name="amount" type="number" step="0.01" min={0} className={styles.narrowInput} />}
            <Select label="Reason" name="reasonCode" className={styles.narrowInput} defaultValue={REFUND_REASONS[0]!.value}>
              {REFUND_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Input label="Note (optional)" name="note" type="text" />
          </div>
          <div className={styles.controls}>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Issuing…" : "Issue credit note"}
            </Button>
          </div>
          {state.error && <p className={styles.error}>{state.error}</p>}
        </form>
      )}
    </Card>
  );
}
