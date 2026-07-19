# ADR-0009 — Guest self-service order writes: privileged server action, not RLS

**Status:** Accepted
**Date:** 2026-07-19

## Context

Slice 2a gave the Booth read-only access to the guest's own order/KOT status, via `withGuest()` + two new `to anon` RLS policies (migration `0026`). Slice 2b needs the guest to actually **write** — add items to a cart, then fire them to the kitchen as a KOT, exactly as staff already do via `apps/pos`/`apps/captain`'s `addOrderItem`/`fireOrder`.

**An anonymous guest cannot write order data today, at three separate layers:**
1. **Table grants.** `anon` has `grant select` only on every table (`0001_auth_uid_stub.sql:24-28`) — no INSERT/UPDATE at all, before RLS is even consulted.
2. **RLS.** Every write-relevant table (`orders`, `order_items`, `kots`, `kot_items`) has a restrictive or permissive policy requiring a staff `memberships` row (`order_item_take_capability`, migration `0014`, explicitly enumerates roles — `anon` isn't one).
3. **Function grants.** Firing needs `next_outlet_event_seq()` (the KOT/event sequence allocator) — `SECURITY DEFINER`, `grant execute ... to authenticated` only, not `anon`.

## Decision

**Guest writes run through a privileged server action** (`apps/booth/lib/order-mutations.ts`), on the same non-RLS-scoped `getDb()` connection `menu-queries.ts`'s `getBoothMenu()` already established a precedent for — no `set local role`, so none of the three walls above apply. This was chosen over the alternative (new `to anon` INSERT/UPDATE grants + policies on `orders`/`order_items`/`kots`/`kot_items`/`order_status_events`/`outlet_event_counters`, plus a carve-out in two restrictive policies, plus a `next_outlet_event_seq` grant to `anon`) because that alternative spreads the guest trust boundary across **six tables and two restrictive policies** — a large, fraud-sensitive surface — versus **one function, `resolveOwnSession()`, that every mutation calls first.**

**This is a deliberate, scoped exception to non-negotiable #7 ("RLS is the security model").** Recorded here, not silently done, per CLAUDE.md's own rule that non-obvious choices get an ADR. The exception is narrow: it applies to exactly the three functions in `order-mutations.ts` (`addToCart`, `removeFromCart`, `placeOrder`), not to Booth reads (still `withGuest`/RLS, unchanged) and not to any staff path (still `withUser`/RLS, unchanged).

### What makes a privileged connection safe here

Every mutation in `order-mutations.ts` calls `resolveOwnSession(tx)` **first, inside the same transaction** as the write that follows:

1. Read the `rb_guest_session` cookie server-side — never a client-supplied session or table id.
2. Join `guest_sessions ⋈ table_sessions` on that id, inside the transaction.
3. Reject if the guest session doesn't exist, is expired, or the table_session has gone terminal (`closed`/`abandoned`/`merged_into`).
4. Return the resolved `tableSessionId`/`outletId`/`storeId`/`businessDayId` — **every subsequent write in that mutation is scoped to these values, not to anything the client sent.**

The guest's own request only ever carries a `menuItemId` (`addToCart`) or an `orderItemId` it's removing (`removeFromCart`, additionally checked against the resolved session's own orders) — never a session id, table id, or price. A guest can only ever write to the table their own cookie belongs to, by construction, the same way `apps/booth/app/t/[token]/route.ts`'s scan gate can only ever mint a cookie for the table it validated.

### Reusing the staff fire logic, not reimplementing it in SQL

The alternative to a privileged TS action was a `SECURITY DEFINER` SQL function (the codebase's other pervasive pattern — 16 already exist, including the closely analogous `next_outlet_event_seq` and `allocate_invoice_block`). Rejected for this specific case: firing requires kitchen-section grouping (`groupByKitchenSection`, `packages/domain/src/kot.ts`) and event emission (`emitOrderStatusEvent`) that already exist as tested TypeScript/shared code. A SQL reimplementation would fork that logic a third time (POS and Captain already duplicate it once each) and risk the two diverging. The privileged-action approach calls the *same* domain function and DB helper the staff paths use — `order-mutations.ts`'s `placeOrder()` is a straight port of `apps/captain/app/floor/[sessionId]/actions.ts`'s `fireOrder`, minus the `mockPrinterBridge` call (a physical-terminal concept a guest's phone has no equivalent of — a guest-fired KOT simply starts `queued`, same as any ticket the kitchen's own bridge hasn't ACK'd yet).

### KOT-number allocation now has a real concurrent-writer risk

Both `applyFireOrder` (POS) and `fireOrder` (Captain) allocate `kot_number` via a bare `SELECT MAX(kot_number)+1` with no lock — an accepted gap when only staff terminals could fire (rare, single-writer-per-outlet in practice). **Guest self-service changes that**: a guest and staff can now fire the same outlet concurrently. `placeOrder()` adds `SELECT ... FOR UPDATE` on the outlet's `business_days` row immediately before the `MAX+1` read, serializing any two fires against the same business day — the same row-locking idiom `scan-queries.ts`'s `seatOrJoinTableSession` already uses (locking `tables`), not a new primitive (no `pg_advisory_*` lock exists anywhere in this codebase, and this ADR doesn't introduce one). The staff-side `fireOrder`/`applyFireOrder` are unchanged; hardening them the same way is a fast-follow, not blocking here.

## The server-side cart, and why it satisfies the browser-resilience requirement

**Owner requirement:** the table stays open and re-joinable until an order is actually fired — a guest might minimize the tab, switch browsers, or lose the cookie and re-scan, before ever placing an order.

This falls out of the design for free: **the cart is not client state.** Tapping a menu item writes a `pending` `order_item` on the shared `table_session` immediately (`addToCart`) — the exact staff model (pending → fired), just guest-triggered. There is no client-side cart array to lose. A re-scan of the table's QR on any browser re-runs `seatOrJoinTableSession` (Slice 1/2a), which **joins the existing, still-open `table_session`** rather than opening a new one — and `getGuestOrderStatus`'s existing RLS-scoped read (migration `0026`) shows that session's pending items regardless of which browser or cookie is asking. "Place order" only ever fires whatever is actually pending on the table at that moment, from whichever browser happens to submit it.

## What this deliberately does not do

- **No optimistic/local cart state.** Every tap is a real server round-trip with a pending UI state (mirrors Captain's `AddItemPicker`) — a double-tap adds two lines (removable individually); a double "Place order" naturally no-ops (the second call finds no pending items left).
- **No audit trail for a removed cart line.** Unlike a staff `voidPendingItem` (which stamps `voided_by` and writes an `order_item_voids` row), a guest removing an item from their own never-fired cart is a hard delete — there's no manager identity to attribute it to and no financial event has happened yet.
- **No `channel_code` distinction.** Guest orders still write `channel_code = 'dinein'` — a Booth guest at a seated table is a dine-in order in every sense that matters to menu pricing (`resolve_menu('dinein', ...)`) and tax. `table_sessions.opened_via = 'guest'` (ADR-0008's amendment) already records Booth origin at the session level; a second signal on every order row would be redundant.
- **Hardening staff-side `fireOrder`/`applyFireOrder` with the same row lock** — flagged above as a fast-follow, not done in this pass (out of scope: this ADR is about enabling the guest path, not revisiting the staff one).
