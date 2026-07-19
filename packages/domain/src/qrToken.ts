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
 */

export type GuestTokenDenialReason =
  | "not_found" // hash didn't match any qr_tokens row
  | "revoked" // explicitly revoked (e.g. a rotation superseded it)
  | "expired" // past rotates_at — the screenshot-from-last-week case
  | "no_open_session"; // table has no active session — the screenshot-from-home case

export type GuestTokenAccessResult =
  | { ok: true }
  | { ok: false; reason: GuestTokenDenialReason };

export interface GuestTokenAccessInput {
  tokenFound: boolean;
  revokedAt: Date | null;
  rotatesAt: Date;
  now: Date;
  /** Whether the table currently has a non-terminal table_session under an
   *  open business_day. A stolen/screenshotted QR is worthless once the
   *  table it names isn't actually being served. */
  hasOpenTableSession: boolean;
}

export function evaluateGuestTokenAccess(input: GuestTokenAccessInput): GuestTokenAccessResult {
  if (!input.tokenFound) return { ok: false, reason: "not_found" };
  if (input.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (input.now.getTime() > input.rotatesAt.getTime()) return { ok: false, reason: "expired" };
  if (!input.hasOpenTableSession) return { ok: false, reason: "no_open_session" };
  return { ok: true };
}

/** User-facing copy for each denial reason — one place so the route handler
 *  and any future retry UI stay in sync. Deliberately vague about WHICH
 *  reason on the "expired/revoked" cases (no reason to help an attacker
 *  distinguish "wrong token" from "right table, wrong time"); the
 *  no-open-session case is the one worth being specific about, since it's
 *  the ordinary "kitchen hasn't seated anyone here yet" case a real guest
 *  can hit. */
export function guestTokenDenialMessage(reason: GuestTokenDenialReason): string {
  switch (reason) {
    case "no_open_session":
      return "This table isn't open right now — please ask a staff member.";
    case "not_found":
    case "revoked":
    case "expired":
      return "This QR code is no longer valid — please rescan the code on your table.";
  }
}
