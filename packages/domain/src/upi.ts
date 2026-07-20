/**
 * The NPCI UPI Deep Linking spec (`upi://pay?...`) — a real, public
 * protocol, not a vendor's private API (CLAUDE.md #8's "no real docs"
 * concern doesn't apply here: this format IS the documentation). Building
 * this link is genuinely different from integrating Razorpay/Cashfree:
 * there is no account, no credentials, no callback — it just opens
 * whichever UPI app the guest already has, pre-filled. The gateway
 * abstraction (apps/booth/lib/payment-gateway.ts) is the mock stand-in for
 * a REAL verified payment; this is a real, working deep link on day one.
 */

export interface UpiIntentInput {
  /** The merchant's UPI address, e.g. "restaurant@upi" (outlets.upi_vpa). */
  vpa: string;
  /** Payee display name shown in the guest's UPI app (outlets.upi_payee_name). */
  payeeName: string;
  amountPaise: bigint;
  /** Shown as the transaction note in the guest's UPI app — typically the invoice number. */
  note: string;
}

/** Paise → a fixed 2-decimal rupee string, no symbol, no thousands separator
 *  — exactly what the `am` param expects ("450.00"). Amount must be
 *  positive: UPI has no concept of paying zero or a negative amount. */
function formatAmountForUpi(amountPaise: bigint): string {
  if (amountPaise <= 0n) throw new Error("buildUpiIntentUrl: amountPaise must be positive");
  const rupees = amountPaise / 100n;
  const paise = amountPaise % 100n;
  return `${rupees}.${paise.toString().padStart(2, "0")}`;
}

/**
 * Builds a real `upi://pay` intent link. `pa`/`pn`/`am`/`cu`/`tn` are the
 * spec's own param names — deliberately not renamed to house style, since
 * matching the spec verbatim is what makes this checkable against it.
 */
export function buildUpiIntentUrl({ vpa, payeeName, amountPaise, note }: UpiIntentInput): string {
  if (!vpa.trim()) throw new Error("buildUpiIntentUrl: vpa is required");
  if (!payeeName.trim()) throw new Error("buildUpiIntentUrl: payeeName is required");

  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: formatAmountForUpi(amountPaise),
    cu: "INR",
    tn: note,
  });
  return `upi://pay?${params.toString()}`;
}
