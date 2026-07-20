import { NextResponse, type NextRequest } from "next/server";
import { GUEST_SESSION_COOKIE } from "./lib/guest-session";

/**
 * Every Booth route needs a valid guest session cookie EXCEPT the scan
 * gate itself (/t/[token], which mints the cookie) and /invalid (where a
 * denied scan lands). This is deliberately a cookie-presence check only —
 * it does not verify the guest_sessions row still exists or hasn't
 * expired; that's what RLS (via queryAsGuest -> withGuest) enforces on
 * every actual read, the same "gate is a fast pre-filter, RLS is the real
 * boundary" split apps/pos's proxy.ts uses for staff auth.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isScanRoute = pathname.startsWith("/t/");
  const isInvalidRoute = pathname.startsWith("/invalid");

  if (isScanRoute || isInvalidRoute) return NextResponse.next();

  const hasGuestSession = request.cookies.has(GUEST_SESSION_COOKIE);
  if (!hasGuestSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/invalid";
    url.searchParams.set("message", "Please scan the QR code on your table to start.");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
