/**
 * The Booth has no staff login and no GoTrue account for guests — a guest's
 * identity is entirely this one opaque cookie, holding the raw
 * `guest_sessions.id` (a randomly generated UUID: 122 bits of entropy,
 * already unguessable on its own, the same way any opaque bearer session
 * token is secure — no additional signing needed). RLS then scopes every
 * guest-side query to exactly that row via `withGuest()`
 * (packages/db/src/guestToken.ts), reading it back out of the
 * `request.jwt.claim.guest_session_id` GUC.
 *
 * Framework-agnostic on purpose (no next/headers import here) so both the
 * route handler (NextResponse.cookies) and middleware (NextRequest.cookies)
 * can share the exact same cookie name/options without importing each
 * other's runtime.
 */

export const GUEST_SESSION_COOKIE = "rb_guest_session";

export function guestSessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
