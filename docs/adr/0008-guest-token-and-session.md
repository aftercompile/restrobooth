# ADR-0008 — Guest QR token design and session identity

**Status:** Accepted
**Date:** 2026-07-19

## ⚠️ Amendment — 2026-07-19 (later)

**The original decision required a table to already have an open `table_session` before a scan would succeed — staff had to seat the table first.** Owner feedback, direct and correct: this defeats the point of self-service QR ordering — it re-adds exactly the staff dependency the Booth exists to remove. **Reversed.** A guest's scan now opens the table itself (`apps/booth/lib/scan-queries.ts`'s `seatOrJoinTableSession`) if nobody has yet, rather than being denied.

**The trade-off, named rather than silently dropped:** the open-table-session check doubled as this ADR's off-premises defense (a screenshotted QR pointed at an unserved table was worthless). Removing it means a still-valid, unrotated token can open a session from anywhere, not just the table — the same trust model most real-world QR-ordering apps (Zomato, Swiggy Dineout) actually use. **Confirmed and accepted**, with one mitigation: a `table_sessions.opened_via` column (`'staff' | 'guest'`, migration `0027`) surfaces as a "Guest-opened" badge on the POS/Captain floor map, so staff notice a table that opened itself. Not a blocker, not added guest friction — a quiet safety net.

**What's unchanged:** the token/hash/rotation design, the cookie/GUC identity mechanism, and the session TTL — all below, as originally decided. What changed is narrower: token *validity* (`evaluateGuestTokenAccess`) and table *seat eligibility* (`evaluateGuestSeatEligibility`, new) are now two separate pure functions in `packages/domain/src/qrToken.ts` instead of one conflated check, and seat eligibility is now about the *outlet* (is there an open business day, is the table flagged `out_of_service`) rather than about *prior staff action*.

## Context

Phase 5 (ROADMAP.md) needs "signed per-table QR tokens (rotating, replay-proof)." TENANCY.md §6's A14 names the required *consequence* ("an expired/replayed token is denied at the token layer before RLS"), and ERD.md §7 sketches the `qr_tokens`/`guest_sessions` table shapes — but no doc decides the actual mechanism: signing algorithm, rotation cadence, or how a scanned token becomes an RLS-scoped session. Per CLAUDE.md's "never invent an API contract" rule, that gap gets closed here, in writing, rather than silently in code.

**Owner-confirmed constraint for the pilot:** printed static per-table QR (table tents), not a device with a rotating on-screen code — the ordinary Indian dine-in reality, and the only realistic option for a single-outlet pilot.

## Decision

### The token: an opaque, hashed, long-lived-but-rotatable secret — not a JWT

A table's QR encodes `https://<booth>/t/{rawToken}`, where `rawToken` is 32 bytes of random entropy (`crypto.randomBytes(32)`, base64url). Only `sha256(rawToken)` is ever stored (`qr_tokens.token_hash`) — matching the schema comment that predates this ADR. On scan, the server hashes the presented token and looks up the row; nothing about the token itself needs to be *signed*, because possession of a value whose hash matches a known row is exactly as strong a proof as a verified signature would be, and is simpler (no key management, no algorithm choice).

`rotates_at` defaults to **180 days out** at mint time (`DEFAULT_TOKEN_ROTATION_DAYS`, packages/db/src/guestToken.ts) — long enough that a pilot restaurant reprints table tents a couple of times a year, not every service. Re-running the mint script for a table **revokes the old token and mints a new one** (rotation, never accumulation) — enforced at the DB level by a partial unique index, `one_live_token_per_table` (`qr_tokens` where `revoked_at is null`), so no code path can ever leave two live tokens on one table even if application logic is wrong.

### Guest identity: an opaque session cookie + a Postgres GUC, not a Supabase Auth JWT

The rest of this codebase's RLS enforcement (`packages/db/src/rls.ts`'s `withUser`) does **not** rely on Postgres verifying a real signed JWT — every app connects to Postgres directly via `pg`/Drizzle (not through PostgREST), and `withUser` manually does `set local role authenticated` + `set_config('request.jwt.claim.sub', userId, true)` inside a transaction, having already verified the caller's identity via a real network call to Supabase Auth (`supabase.auth.getUser()`).

Guests have no Supabase Auth account at all (there is no email/password, and Supabase's "anonymous sign-in" GoTrue feature is not used anywhere in this codebase). So minting a real signed JWT for guests would introduce a second identity mechanism, a new secret (`SUPABASE_JWT_SECRET`), and a signing library, purely to re-derive a security property (RLS scoping) the codebase already gets from the `set_config` GUC pattern. Instead:

- `apps/booth/lib/guest-session.ts` defines one httpOnly, `sameSite=lax`, secure-in-production cookie (`rb_guest_session`) holding the **raw `guest_sessions.id`** — a randomly generated UUID, 122 bits of entropy, exactly as unguessable as a signed token would be, and the same trust model any opaque bearer session ID already uses.
- `packages/db/src/guestToken.ts`'s `withGuest()` is the guest-side twin of `withUser`: `set local role anon` + `set_config('request.jwt.claim.guest_session_id', ...)`, matching the `to anon ... using (id = ... current_setting('request.jwt.claim.guest_session_id', true) ...)` policies `0005_rls_policies.sql` already shipped in Phase 1.

**Net effect: zero new secrets, zero new libraries, and the guest path uses the exact same RLS-scoping mechanism the staff path already does** — one mechanism, two identities, not two mechanisms.

### The A14 gate: reject before any RLS-scoped query, and before a session exists

`packages/domain/src/qrToken.ts`'s `evaluateGuestTokenAccess()` is the pure token-validity decision (100% branch-covered): a scanned token is denied if the hash isn't found, if `revoked_at` is set, or if `now > rotates_at`. That's the whole check — no table-state involved, since (per the amendment above) a valid token is now allowed to open a table itself rather than requiring one to already be open.

A second, separate pure function, `evaluateGuestSeatEligibility()`, answers a different question once the token is valid: can a guest's scan actually seat/join *this* table right now? Denied if the outlet has no open `business_day` (CLAUDE.md's "no open day → no bill" rule extends here — a table can't be opened at all if the day hasn't started), or if the table is flagged `tables.status = 'out_of_service'` (a maintenance flag, not occupancy). `apps/booth/lib/scan-queries.ts`'s `seatOrJoinTableSession()` implements this against real DB state: row-locks the table (`select ... for update`) so two guests scanning the same table at the same instant can't race into two separate sessions, joins an existing non-terminal session if one exists, or opens a new one (`opened_via: 'guest'`) if none does.

All of this runs in `apps/booth/app/t/[token]/route.ts` against a plain, privileged `Database` connection — **before** a `guest_sessions` row exists and **before** any `withGuest`-scoped (RLS-enforced) query runs. Only once both checks pass does a `guest_sessions` row get created and the cookie get set.

### Session TTL

3 hours (`GUEST_SESSION_TTL_MS`) — long enough for a full dine-in meal without a mid-service rescan, short enough that a phone left behind stops being useful for ordering the same evening. Not tied to the table token's own `rotates_at` — a guest's session outliving the printed token by a few hours on the day it's rotated is harmless; the reverse (a session that outlives the table's actual service) is the thing worth bounding.

## What this deliberately does not do (yet)

- **No geofencing / IP-based "off-premises" detection.** Accepted gap post-amendment (see above) — token rotation/revocation is the only off-premises defense now, mitigated by the floor map's "Guest-opened" visibility, not blocked at the guest.
- **No per-scan single-use token.** The printed token is reusable by design (a guest may need to reload the page, or a second guest at the same table scans the same tent) — it's the *session* that's short-lived, not the token's use-count.
- **No "un-claim" flow.** If a guest auto-seats a table by mistake (wrong QR, walked away), the table stays `opened_via: 'guest'` until staff close it normally — same lifecycle as any other seated table, no special guest-initiated-session teardown.
- **Real Razorpay integration** is out of scope for this ADR — see PROGRESS.md's Phase 5 plan; the payment gateway sits behind an interface and is a separate decision.
