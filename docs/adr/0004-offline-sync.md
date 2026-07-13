# ADR-0004 — Offline-first billing: outbox, idempotency, reserved number blocks

**Status:** Accepted — **gate item**
**Date:** 2026-07-13

## Context

"A POS that dies with the WiFi is not a POS." An Indian restaurant's internet drops at 8:40 PM on a Saturday, and the correct behaviour is that nobody in the building notices.

This is the highest-risk subsystem in the product. The failure modes are: a duplicate bill (money invented), a lost order (guest doesn't eat), a duplicate KOT (food cost invented), a renumbered invoice (illegal), and a table stuck occupied (floor unusable). All five are worse than being offline.

## Decision

**Local-first write path: Dexie (IndexedDB) + an outbox, with client-generated idempotency keys and server-issued reserved invoice-number blocks. Conflict resolution is per-entity, not global.**

### 1. The write path

Every mutation, online or offline, takes the **same** path:

```
  UI action
    → validate against local domain rules (packages/domain — pure, runs identically both sides)
    → write to local Dexie store          (the UI reads from here; it is always instant)
    → append to outbox with a client-generated idempotency key (UUIDv7)
    → outbox drains to the server whenever connectivity allows
```

**There is no separate "offline mode."** The terminal is *always* offline-first; the network is an implementation detail of the outbox drain. This is the single most important structural decision here — a codebase with an `if (offline)` branch in the billing path will have bugs in exactly one of the two branches, and it will be the one you don't test. The POS is fast (<100 ms) *because* it never waits on a network round-trip, not despite it.

`packages/domain` being pure and dependency-free is what makes this possible: **the same money math runs on the terminal and on the server, and produces the same paise.** The server still recomputes and its answer wins ([DOMAIN.md](../DOMAIN.md) §5.2), but a disagreement is a bug to be alarmed on, not a routine reconciliation.

### 2. Idempotency

Every mutation carries a client-generated `idempotency_key` (UUIDv7 — sortable, so causal replay order is recoverable from the key alone). Server side, `idempotency_keys` ([ERD.md](../ERD.md) §8) stores the key, a hash of the request body, and the response.

- Same key + same body hash → **return the stored response, do not re-execute.**
- Same key + *different* body hash → **409.** That is a client bug; it must be loud.

This single mechanism underwrites offline sync, aggregator webhooks, and payment callbacks. It is the same table for all three.

### 3. Invoice numbers offline: reserved blocks

Fully specified in [DOMAIN.md](../DOMAIN.md) §6.3. In brief:

- Terminals hold a **reserved contiguous block** of sequence numbers, issued server-side with an `exclude using gist` constraint that makes overlapping blocks **impossible at the database level**.
- Low-watermark auto-top-up at 30% remaining, while still online.
- If a block exhausts *while* offline: fall back to the terminal's **dedicated offline series** (legal — CGST Rule 46(b) permits multiple series).
- Unused numbers become **gaps**, recorded with a reason in the gap register. **Never reused.**
- **We never renumber a printed invoice on sync.** The guest is holding it.

### 4. Conflict resolution: per entity

The full table is in [DOMAIN.md](../DOMAIN.md) §8 and is a gate item. The headline:

| | Rule |
|---|---|
| `order_item` | **Append-only merge.** Never LWW — LWW loses a guest's food. |
| `table_session` **open** | **Auto-merge.** Two captains seating table 7 must not cost anyone their orders. |
| `table_session` **close** | **Server rejects with replay.** LWW here *is* the "table occupied after the guests left" bug. |
| `bill` | **Immutable, idempotency-key dedup, never renumbered.** Genuine duplicates flag for a manager — money is never auto-resolved. |
| `payment` | **At-most-once.** |
| availability (86) | **LWW, asymmetric** — `unavailable` beats `available`. Believe the pessimist. |
| menu / prices | **Read-only on terminals.** No conflict is possible by construction. |

The reason a single global rule fails: **`order_items` and `table_session` want opposite things.** Orders must never be lost, so they merge. Occupancy must never be stale, so it rejects. Any global policy gets one of them wrong.

### 5. What is NOT available offline

Stated plainly so nobody promises it:

- **Card / UPI gateway payments.** They need the network by definition. Offline, the tender options are **cash** and **"pay at counter later"** (a due), and the UI must say so rather than fail mysteriously.
- **Inventory deduction.** Happens server-side on replay. Offline stock levels are advisory, not authoritative.
- **Aggregator orders.** Cannot arrive without a network.
- **Anything a guest does on the Booth.** The guest's phone has its own connection; if the restaurant is offline, the Booth degrades to "call the waiter."
- **Menu or price changes.** By design.

## Consequences

- **Positive:** the POS is genuinely fast because it never blocks on the network, offline or on.
- **Positive:** one code path. No `if (offline)` branch in the billing logic.
- **Positive:** invoice-number correctness is enforced by a database constraint, not by careful code.
- **Negative:** local state must be encrypted at rest (it holds bills and guest PII) and cleared on logout. IndexedDB is not a secure store; a lost tablet is a data-breach vector. **Mitigation: short-lived local retention (current business day only), device PIN, and remote wipe on terminal deactivation.** This is a Phase 10 security-review item and it is easy to forget.
- **Negative:** an outbox that fails to drain (a permanently-rejected mutation) will block everything behind it. **Mitigation: a rejected mutation is surfaced to the human immediately and can be skipped explicitly, with an audit row.** Nothing retries silently forever, and nothing is silently discarded.
- **Risk:** clock skew on the terminal. A terminal with a wrong clock could stamp a bill with the wrong `business_date`. **Mitigation: `business_date` is never taken from the client — it is copied from the open `business_day` row.** Timestamps are server-stamped on arrival; the client's clock is used only for local ordering, and UUIDv7 makes even that robust.

## The acceptance test (Phase 3b gate)

Kill the network mid-service. Bill four tables. Reconnect **twice**, with an interleaved reconnect from a second terminal that was also offline. Assert:

- **zero** duplicate bills
- **zero** lost order items
- **zero** duplicate KOTs
- **zero** invoice-series gaps that are not in the gap register
- every rejected mutation was surfaced to a human, and none was silently dropped
