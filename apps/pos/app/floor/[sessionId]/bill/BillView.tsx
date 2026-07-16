"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader } from "@restrobooth/ui";
import { finalizeBill, settleBill, splitBillByAmount, splitBillByItems, voidBill, type ActionState } from "./actions";
import type { BillPreview, ExistingBill } from "./queries";
import styles from "./page.module.css";

const INITIAL: ActionState = { error: null };

function formatRupees(paise: string | bigint): string {
  const n = typeof paise === "bigint" ? paise : BigInt(paise);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? "-" : ""}₹${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export function BillView({ sessionId, preview, bills }: { sessionId: string; preview: BillPreview; bills: ExistingBill[] }) {
  const hasActiveBill = bills.some((b) => b.status !== "voided");

  if (!hasActiveBill) {
    return <FinalizeForm sessionId={sessionId} preview={preview} />;
  }

  return (
    <div className={styles.billList}>
      {bills.map((bill) =>
        bill.status === "finalised" ? (
          <SettleView key={bill.billId} sessionId={sessionId} bill={bill} />
        ) : (
          <Card padded key={bill.billId}>
            <p>
              Invoice <strong>{bill.invoiceNo}</strong> — {bill.status}
            </p>
            <p className={styles.totalsRow}>
              <span>Payable</span>
              <span className={styles.lineAmount}>{formatRupees(bill.payablePaise)}</span>
            </p>
            {bill.status !== "voided" && <Link href={`/bill/${bill.billId}`}>View / print invoice</Link>}
          </Card>
        ),
      )}
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

      {mode === "one" && <OneBillControls sessionId={sessionId} lineCount={preview.lines.length} />}
      {mode === "items" && <SplitByItemsControls sessionId={sessionId} preview={preview} />}
      {mode === "amount" && <SplitByAmountControls sessionId={sessionId} />}
    </>
  );
}

function OneBillControls({ sessionId, lineCount }: { sessionId: string; lineCount: number }) {
  const [state, formAction, pending] = useActionState(finalizeBill, INITIAL);
  const [discountKind, setDiscountKind] = useState<"none" | "flat" | "percent">("none");

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <div className={styles.controls}>
        <label>
          Discount
          <select
            name="discountKind"
            className={styles.select}
            value={discountKind}
            onChange={(e) => setDiscountKind(e.target.value as typeof discountKind)}
          >
            <option value="none">None</option>
            <option value="flat">Flat (₹)</option>
            <option value="percent">Percent (%)</option>
          </select>
        </label>
        {discountKind !== "none" && (
          <input
            type="number"
            name="discountValue"
            step="0.01"
            min={0}
            className={styles.narrowInput}
            placeholder={discountKind === "flat" ? "Amount ₹" : "Percent %"}
          />
        )}
        <label>
          Service charge %
          <input type="number" name="serviceChargeBps" step="1" min={0} defaultValue={0} className={styles.narrowInput} />
        </label>
        <Button type="submit" variant="primary" disabled={pending || lineCount === 0}>
          {pending ? "Finalising…" : "Finalise bill"}
        </Button>
      </div>
      {state.error && <p className={styles.error}>{state.error}</p>}
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

function SettleView({ sessionId, bill }: { sessionId: string; bill: ExistingBill }) {
  const [payState, payAction, payPending] = useActionState(settleBill, INITIAL);
  const [voidState, voidAction, voidPending] = useActionState(voidBill, INITIAL);

  const paidPaise = BigInt(bill.paidPaise);
  const payablePaise = BigInt(bill.payablePaise);
  const remainingPaise = payablePaise - paidPaise;

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
        <span>Paid so far</span>
        <span className={styles.lineAmount}>{formatRupees(paidPaise)}</span>
      </div>
      <div className={`${styles.totalsRow} ${styles.grand}`}>
        <span>Remaining</span>
        <span className={styles.lineAmount}>{formatRupees(remainingPaise)}</span>
      </div>

      {remainingPaise > 0n && (
        <form action={payAction} className={styles.controls}>
          <input type="hidden" name="billId" value={bill.billId} />
          <input type="hidden" name="sessionId" value={sessionId} />
          <label>
            Method
            <select name="method" className={styles.select} defaultValue="cash">
              <option value="cash">Cash</option>
              <option value="upi_intent">UPI</option>
              <option value="card">Card</option>
              <option value="netbanking">Netbanking</option>
              <option value="wallet">Wallet</option>
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
          <Button type="submit" variant="primary" disabled={payPending}>
            {payPending ? "Recording…" : "Add payment"}
          </Button>
          {payState.error && <span className={styles.error}>{payState.error}</span>}
        </form>
      )}

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
