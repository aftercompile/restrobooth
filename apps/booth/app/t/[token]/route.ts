import { NextResponse, type NextRequest } from "next/server";
import { hashToken, lookupTokenByHash } from "@restrobooth/db";
import { evaluateGuestTokenAccess, guestTokenDenialMessage, seatEligibilityDenialMessage } from "@restrobooth/domain";
import { getDb } from "../../../lib/db";
import { createGuestSession, seatOrJoinTableSession } from "../../../lib/scan-queries";
import { GUEST_SESSION_COOKIE, guestSessionCookieOptions } from "../../../lib/guest-session";

/**
 * The A14 gate (TENANCY.md §6): validate a scanned table QR entirely
 * BEFORE any RLS-scoped query runs — hash lookup, revoked_at, rotates_at,
 * all against a plain, privileged `Database` connection. RLS only starts
 * applying once a `guest_sessions` row and its cookie exist.
 *
 * ADR-0008 amendment: a valid scan now OPENS the table if nobody has
 * (seatOrJoinTableSession), rather than requiring staff to have seated it
 * first — token validity and seat eligibility are deliberately two
 * separate checks (packages/domain/src/qrToken.ts), so a valid-but-denied
 * scan (outlet not open yet, table flagged out of service) gets its own
 * specific message rather than being folded into "QR code invalid."
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const db = getDb();

  const tokenRow = await lookupTokenByHash(db, hashToken(rawToken));

  const access = evaluateGuestTokenAccess({
    tokenFound: tokenRow !== null,
    revokedAt: tokenRow?.revokedAt ?? null,
    rotatesAt: tokenRow?.rotatesAt ?? new Date(0),
    now: new Date(),
  });

  if (!access.ok) {
    const url = new URL("/invalid", request.url);
    url.searchParams.set("message", guestTokenDenialMessage(access.reason));
    return NextResponse.redirect(url);
  }
  if (!tokenRow) {
    // Unreachable given evaluateGuestTokenAccess's contract — satisfies TS
    // narrowing only.
    return NextResponse.redirect(new URL("/invalid", request.url));
  }

  let seat;
  try {
    seat = await seatOrJoinTableSession(db, { outletId: tokenRow.outletId, tableId: tokenRow.tableId });
  } catch (err) {
    // A genuine outlet misconfiguration (seatOrJoinTableSession's "exactly
    // one active store" check) — a setup bug, not a normal guest outcome.
    // Never surface a raw 500/stack trace to an unauthenticated guest.
    console.error("seatOrJoinTableSession failed", err);
    return NextResponse.redirect(new URL("/invalid", request.url));
  }
  if (!seat.ok) {
    const url = new URL("/invalid", request.url);
    url.searchParams.set("message", seatEligibilityDenialMessage(seat.reason));
    return NextResponse.redirect(url);
  }

  const guest = await createGuestSession(db, {
    tableSessionId: seat.tableSessionId,
    storeId: seat.storeId,
    qrTokenId: tokenRow.id,
  });

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(GUEST_SESSION_COOKIE, guest.id, guestSessionCookieOptions(guest.expiresAt));
  return response;
}
