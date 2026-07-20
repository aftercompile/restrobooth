/**
 * ADR-0010: the interface a real, verified gateway (Razorpay/Cashfree —
 * ADR-0001's Hobby→Pro trigger, ROADMAP.md's HMAC-verified-webhook shape)
 * would implement later. No real payment is processed anywhere behind
 * this file today — `MockPaymentGateway` always captures — but every call
 * site (`payment-mutations.ts`'s `payGuestBill`) is written against this
 * interface, not against the mock directly, so swapping in the real thing
 * later is a single implementation added here, not a rewrite of the
 * transaction that calls it. Same "code to the interface, build the mock"
 * discipline CLAUDE.md #8 asks for wherever there's no real vendor docs to
 * build against — there's a real payment gateway to eventually build
 * against, just not yet.
 */

export interface PaymentChargeResult {
  status: "captured" | "failed";
  gatewayTxnId: string;
}

export interface PaymentGateway {
  charge(amountPaise: bigint): Promise<PaymentChargeResult>;
}

/** Always captures. This is the entire "gateway" a mock-only, no-real-money
 *  test deployment can honestly offer — see ADR-0010 for why the mock path
 *  is allowed to auto-settle while cash/UPI can't (this class never touches
 *  real money either way; it's what the STAFF trust boundary does with the
 *  result that differs). */
export class MockPaymentGateway implements PaymentGateway {
  async charge(_amountPaise: bigint): Promise<PaymentChargeResult> {
    return { status: "captured", gatewayTxnId: `mock_${crypto.randomUUID()}` };
  }
}
