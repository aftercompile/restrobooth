# ADR-0008 — Guest QR token design and session identity

**Status:** Accepted
**Date:** 2026-07-19

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

`packages/domain/src/qrToken.ts`'s `evaluateGuestTokenAccess()` is the pure decision (100% branch-covered): a scanned token is denied if the hash isn't found, if `revoked_at` is set, if `now > rotates_at`, **or if the table has no open `table_session` under an open `business_day`.** That last check is deliberate and is the actual replay/off-premises defense: a screenshotted QR, used from home or after the table has turned over, points at a table nobody is currently serving, so `findOpenTableSession()` (`apps/booth/lib/scan-queries.ts`) returns nothing and access is denied — no geofencing, no device fingerprinting, no expiring-every-few-minutes rotation that would need hardware at every table.

All of this runs in `apps/booth/app/t/[token]/route.ts` against a plain, privileged `Database` connection — **before** a `guest_sessions` row exists and **before** any `withGuest`-scoped (RLS-enforced) query runs. Only once `evaluateGuestTokenAccess` returns `ok: true` does a `guest_sessions` row get created and the cookie get set.

### Session TTL

3 hours (`GUEST_SESSION_TTL_MS`) — long enough for a full dine-in meal without a mid-service rescan, short enough that a phone left behind stops being useful for ordering the same evening. Not tied to the table token's own `rotates_at` — a guest's session outliving the printed token by a few hours on the day it's rotated is harmless; the reverse (a session that outlives the table's actual service) is the thing worth bounding.

## What this deliberately does not do (yet)

- **No geofencing / IP-based "off-premises" detection.** The open-table-session check is the off-premises defense; it's simpler, needs no third-party IP-geolocation data, and directly encodes the actual invariant that matters ("is this table being served"), rather than a proxy for it.
- **No per-scan single-use token.** The printed token is reusable by design (a guest may need to reload the page, or a second guest at the same table scans the same tent) — it's the *session* that's short-lived and the *table's* open/closed state that's the real gate, not the token's use-count.
- **Real Razorpay integration** is out of scope for this ADR — see PROGRESS.md's Phase 5 plan; the payment gateway sits behind an interface and is a separate decision.
