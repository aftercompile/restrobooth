/**
 * Guest QR token access rule — TENANCY.md §6, test case A14: "an expired or
 * replayed Booth QR token must be denied at the token layer before RLS is
 * even consulted." This function IS that gate — it runs against a scanned
 * token's looked-up row, before any RLS-scoped query is issued, and before
 * a `guest_sessions` row is ever created.
 *
 * Pure. No I/O — the caller (packages/db) does the lookup and passes in
 * plain values, exactly like tableSession.ts's transition rules take plain
 * status strings rather than DB rows.
 *
 * ADR-0008 amendment (Slice 2a follow-up): this used to also require the
 * scanned table to already have an open table_session — the original
 * off-premises defense ("a screenshotted QR is worthless once the table
 * isn't actually being served"). The owner's call, made deliberately with
 * the trade-off named: requiring staff to pre-seat a table before a guest
 * can even open the menu defeats the point of self-service QR ordering.
 * Token validity (this function) and "can a guest seat THIS table right
 * now" (evaluateGuestSeatEligibility, below) are now two separate
 * questions — the route auto-seats an available table rather than
 * rejecting the scan. What's left of the off-premises defense is token
 * rotation/revocation alone, same trust model most real-world QR-ordering
 * apps use; the accepted mitigation is a staff-visible "guest-opened" flag
 * on the floor map (apps/pos, apps/captain), not a guest-side blocker.
 */

export type GuestTokenDenialReason =
  | "not_found" // hash didn't match any qr_tokens row
  | "revoked" // explicitly revoked (e.g. a rotation superseded it)
  | "expired"; // past rotates_at — the screenshot-from-last-week case

export type GuestTokenAccessResult =
  | { ok: true }
  | { ok: false; reason: GuestTokenDenialReason };

export interface GuestTokenAccessInput {
  tokenFound: boolean;
  revokedAt: Date | null;
  rotatesAt: Date;
  now: Date;
}

export function evaluateGuestTokenAccess(input: GuestTokenAccessInput): GuestTokenAccessResult {
  if (!input.tokenFound) return { ok: false, reason: "not_found" };
  if (input.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (input.now.getTime() > input.rotatesAt.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** User-facing copy for a denied token — deliberately vague about WHICH
 *  reason (no reason to help an attacker distinguish "wrong token" from
 *  "right table, wrong time"). */
export function guestTokenDenialMessage(_reason: GuestTokenDenialReason): string {
  return "This QR code is no longer valid — please rescan the code on your table.";
}

// ---------------------------------------------------------------------------

export type SeatEligibilityDenialReason =
  | "outlet_not_open" // no open business_day at this outlet — cannot seat a table (CLAUDE.md's "no open day -> no bill" rule)
  | "table_out_of_service"; // tables.status = 'out_of_service' — a maintenance flag, not occupancy

export type SeatEligibilityResult =
  | { ok: true }
  | { ok: false; reason: SeatEligibilityDenialReason };

export interface SeatEligibilityInput {
  businessDayOpen: boolean;
  tableStatus: "available" | "out_of_service";
}

/**
 * A separate question from token validity: given a VALID token, can a
 * guest's scan actually open (or join) this table right now? Runs after
 * evaluateGuestTokenAccess passes, before the route seats/joins a
 * table_session. Kept as its own pure function rather than folded into
 * evaluateGuestTokenAccess — token validity is a property of the token
 * alone; seat eligibility is a property of live outlet/table state, and
 * conflating them made the token-access function need DB reads it
 * shouldn't need to know about.
 */
export function evaluateGuestSeatEligibility(input: SeatEligibilityInput): SeatEligibilityResult {
  if (!input.businessDayOpen) return { ok: false, reason: "outlet_not_open" };
  if (input.tableStatus === "out_of_service") return { ok: false, reason: "table_out_of_service" };
  return { ok: true };
}

export function seatEligibilityDenialMessage(reason: SeatEligibilityDenialReason): string {
  switch (reason) {
    case "outlet_not_open":
      return "This outlet hasn't opened for the day yet — please ask a staff member.";
    case "table_out_of_service":
      return "This table isn't available right now — please ask a staff member.";
  }
}
