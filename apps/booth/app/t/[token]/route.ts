import { NextResponse, type NextRequest } from "next/server";
import { hashToken, lookupTokenByHash } from "@restrobooth/db";
import { evaluateGuestTokenAccess, guestTokenDenialMessage } from "@restrobooth/domain";
import { getDb } from "../../../lib/db";
import { createGuestSession, findOpenTableSession } from "../../../lib/scan-queries";
import { GUEST_SESSION_COOKIE, guestSessionCookieOptions } from "../../../lib/guest-session";

/**
 * The A14 gate (TENANCY.md §6): validate a scanned table QR and, if it
 * passes, mint a guest session — entirely BEFORE any RLS-scoped query runs.
 * Every check here (hash lookup, revoked_at, rotates_at, open table
 * session) happens against a plain, privileged `Database` connection; RLS
 * only starts applying once a `guest_sessions` row and its cookie exist.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: rawToken } = await params;
  const db = getDb();

  const tokenRow = await lookupTokenByHash(db, hashToken(rawToken));
  const session = tokenRow ? await findOpenTableSession(db, tokenRow.tableId) : null;

  const access = evaluateGuestTokenAccess({
    tokenFound: tokenRow !== null,
    revokedAt: tokenRow?.revokedAt ?? null,
    rotatesAt: tokenRow?.rotatesAt ?? new Date(0),
    now: new Date(),
    hasOpenTableSession: session !== null,
  });

  if (!access.ok) {
    const url = new URL("/invalid", request.url);
    url.searchParams.set("message", guestTokenDenialMessage(access.reason));
    return NextResponse.redirect(url);
  }
  if (!tokenRow || !session) {
    // Unreachable given evaluateGuestTokenAccess's contract (ok implies
    // both are non-null) — this only satisfies TS narrowing.
    return NextResponse.redirect(new URL("/invalid", request.url));
  }

  const guest = await createGuestSession(db, {
    tableSessionId: session.tableSessionId,
    storeId: session.storeId,
    qrTokenId: tokenRow.id,
  });

  // /menu doesn't exist yet (Slice 2) — land on the stub home page for now;
  // this redirect target moves to /menu once that route is built.
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(GUEST_SESSION_COOKIE, guest.id, guestSessionCookieOptions(guest.expiresAt));
  return response;
}
