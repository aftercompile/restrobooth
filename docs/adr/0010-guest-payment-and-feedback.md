# ADR-0010 — Guest payment: hybrid settle model, mock gateway behind an interface, and feedback

**Status:** Accepted
**Date:** 2026-07-20

## Context

Phase 5 Slice 3 — the last piece of the Booth arc ROADMAP.md names ("QR → order → pay → feedback") before the pilot gate. Almost all the money machinery already exists (`bills`/`payments` schema, `bill_requested → settling → closed`, POS's `applyFinalizeBill`/`applySettleBill`) — what's new is letting a **guest** trigger it, and deciding what "the guest paid" is allowed to mean when nothing in this deployment can actually verify a real payment happened (ADR-0001: no real gateway integration until Phase 5's Hobby→Pro move, and even then real Razorpay is separately scoped, not this slice).

## Decision 1 — hybrid settle: mock auto-settles, cash/UPI stay a staff-confirmed claim

`payments.status` already has both `pending` and `captured` — unused by any guest path before this slice, but exactly the mechanism this needs:

- **`method: "mock"`** (the `MockPaymentGateway` stand-in for a future real, verified gateway) writes a `captured` payment immediately and runs the same settle rule POS's `applySettleBill` already uses — captured sum ≥ payable ⇒ bill `settled` ⇒ session `closed`. This is honest: the mock genuinely is the full "gateway" a no-real-money test deployment can offer, so treating its result as authoritative doesn't overclaim anything.
- **`cash` / `upi_intent`** write a `pending` payment — the guest's *claim*, not a verified fact — and leave the session `settling`. A staff member confirms receipt on POS (`confirmGuestPayment`, `apps/pos/app/floor/[sessionId]/bill/actions.ts`) before it counts, surfaced two ways: on the bill itself (`BillView.tsx`'s `PendingGuestPaymentRow`) and as a "Payment to confirm" state in the floor card's notification band (this session's earlier work), prioritized alongside `waiterCalledAt` — both are "someone needs staff, now" signals.

**Rejected: guest self-service for every method** (any method auto-settles, no staff step) — simplest, but a guest could mark a bill paid without paying; acceptable only while the test deployment processes zero real money, a real hole the moment real cash/UPI is involved at the pilot. **Rejected: staff-confirm for every method, including mock** — safest, but then the mock gateway does nothing self-service and isn't standing in for anything. The hybrid is the one option where the mock's behavior (auto-settle) is actually a preview of what the real gateway will do later, and cash/UPI's behavior (staff-confirmed) is honest about what can't be verified today.

## Decision 2 — `PaymentGateway` interface, mock implementation, real gateway deferred

`apps/booth/lib/payment-gateway.ts` defines `PaymentGateway { charge(amountPaise): Promise<{status, gatewayTxnId}> }`; `MockPaymentGateway` always captures. `payGuestBill` (`payment-mutations.ts`) is written against the interface, not the mock class directly — swapping in real Razorpay/Cashfree later (ROADMAP.md's HMAC-verified-webhook shape, `payments.gateway`/`gateway_txn_id` already exist for exactly this) is a new implementation of this interface plus a webhook route, not a rewrite of the transaction that settles the bill. Same "code to the interface, build the mock" discipline CLAUDE.md #8 asks for anywhere there's no real vendor contract to build against yet.

The real `upi://pay` deep link (`packages/domain/src/upi.ts`'s `buildUpiIntentUrl`) is a **different kind of thing** from the gateway mock — it's a real, public, documented protocol (NPCI's UPI Deep Linking spec), not a vendor's private API, so CLAUDE.md #8's "no real docs" concern doesn't apply to it the way it does to Razorpay. It needed one genuinely new piece of config that didn't exist anywhere: `outlets.upi_vpa` / `upi_payee_name` (migration `0029`, nullable — an outlet with neither simply doesn't offer the UPI method; `getGuestContext`'s `upiAvailable` flag gates it client-side). The Booth's own tender is still a *claim* either way (the guest completing payment in their own UPI app produces no callback this deployment can see), so it's written as a `pending` payment, same as cash — the deep link only changes how the guest pays, not whether staff still confirm it.

## Decision 3 — guest self-finalise duplicates POS's finalise, on the privileged connection

`finalizeGuestBill()` re-implements `applyFinalizeBill`'s logic (compute → draw invoice number via `next_invoice_seq` → freeze `dining/bill_requested → settling`) rather than importing across apps — same tradeoff ADR-0009 already accepted for `placeOrder` vs. `fireOrder`, for the same reason (apps don't import from each other's source in this monorepo; `packages/domain`'s `computeBill`/`financialYearFor`/`formatInvoiceNumber` are what's actually shared, not the orchestration around them). It reuses whatever staff already finalised if a bill exists (idempotent on re-visit/refresh), and refuses a **split** bill (more than one finalised/settled bill on the session) with a "please ask a staff member" message — split-by-item/guest/amount stays a POS-only capability; a guest always pays one whole bill.

Runs on the same privileged, non-RLS connection every other guest write in `apps/booth/lib/order-mutations.ts` does (ADR-0009's exception, unchanged — not widened by this ADR), through the same `resolveOwnSession()` trust boundary. `resolveOwnSession` gained one new parameter, `allowClosed`: the mock path closes the guest's own session as part of settling it, and `submitFeedback` legitimately runs immediately after — the one place a guest's own request against their own now-closed session is expected, not a bug. `getGuestContext()` (the page-level guard) got the identical `allowClosed` option for the same reason, used only by `/pay`.

## Decision 4 — feedback: rating (required) + comment (optional), one row per visit

New `feedback` table (migration `0029`, partitioned by `business_date` — same convention as every other business-event table here, `create_partitions_ahead`'s array). `rating` 1–5, `comment` free text, `unique(table_session_id, business_date)` — one submission per visit, enforced structurally rather than trusted to the UI. Written via the same privileged-connection pattern (no RLS/`anon` grant needed for the write; the `feedback_isolation` policy exists for staff reads).

**Deliberately minimal.** RESTROBOOTH_BRIEF.md assigns rich aspect/sentiment extraction (taste, portion, wait, service, dish reference) to **Phase 6's AI layer**, mining exactly this raw `comment` text later — this slice captures the signal, it doesn't analyze it. A richer capture (tap-to-select aspect tags alongside the rating) was considered and rejected: it pre-empts and partially duplicates what the Phase 6 NLP step is meant to derive from free text, for no benefit this slice needs.

## What this deliberately does not do

- **Real Razorpay/Cashfree integration, webhooks, HMAC verification** — ADR-0001's Hobby→Pro trigger and ROADMAP.md's later-phase shape; `PaymentGateway` exists so this is additive later, not a rewrite.
- **Guest-side split payment** — a guest always pays one whole bill; split-by-item/guest/amount stays POS-only.
- **Guest-applied discount or service charge** — `finalizeGuestBill` always produces a plain bill; either requires staff to finalise first via POS.
- **Offline guest payment** — the Booth is a phone that's already online if it loaded at all; ADR-0004's offline-tender rules (cash-only, needs-network gating) are a POS/cashier concern this slice doesn't touch.
- **Mirroring "payment to confirm" to Captain's floor** — Captain has no bill screen of its own (an existing, prior decision — billing is a POS/cashier capability), so the confirm action lives on POS only, matching how bill-status badges already work there.
