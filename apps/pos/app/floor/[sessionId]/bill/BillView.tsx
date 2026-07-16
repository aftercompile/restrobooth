"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader } from "@restrobooth/ui";
import { finalizeBill, settleBill, voidBill, type ActionState } from "./actions";
import type { BillPreview, ExistingBill } from "./queries";
import styles from "./page.module.css";

const INITIAL: ActionState = { error: null };

function formatRupees(paise: string | bigint): string {
  const n = typeof paise === "bigint" ? paise : BigInt(paise);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  return `${negative ? "-" : ""}₹${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

export function BillView({
  sessionId,
  preview,
  existingBill,
}: {
  sessionId: string;
  preview: BillPreview;
  existingBill: ExistingBill | null;
}) {
  const hasActiveBill = existingBill && existingBill.status !== "voided";

  if (!hasActiveBill) {
    return <FinalizeForm sessionId={sessionId} preview={preview} />;
  }

  if (existingBill.status === "finalised") {
    return <SettleView sessionId={sessionId} bill={existingBill} />;
  }

  // settled / refunded_partial / refunded_full
  return (
    <Card padded>
      <p>
        Invoice <strong>{existingBill.invoiceNo}</strong> — {existingBill.status}
      </p>
      <p className={styles.totalsRow}>
        <span>Payable</span>
        <span className={styles.lineAmount}>{formatRupees(existingBill.payablePaise)}</span>
      </p>
      <Link href={`/bill/${existingBill.billId}`}>View / print invoice</Link>
    </Card>
  );
}

function FinalizeForm({ sessionId, preview }: { sessionId: string; preview: BillPreview }) {
  const [state, formAction, pending] = useActionState(finalizeBill, INITIAL);
  const [discountKind, setDiscountKind] = useState<"none" | "flat" | "percent">("none");

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
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
        <Button type="submit" variant="primary" disabled={pending || preview.lines.length === 0}>
          {pending ? "Finalising…" : "Finalise bill"}
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
    <>
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
      </Card>

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
    </>
  );
}
