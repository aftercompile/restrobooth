# ADR-0005 — Realtime transport for KDS, floor map, and Booth

**Status:** Accepted
**Date:** 2026-07-13

## Context

The brief asks (§10.8): *"Is Realtime enough for the KDS, or does it need a heartbeat + polling fallback? (It needs the fallback. Prove me right or wrong.)"*

**You are right, and there is a second reason you did not name — which is the one that actually constrains the architecture.**

Three surfaces need push: the **KDS** (new tickets), the **floor map** (table state), and the **Booth** (guest order status).

## The case against bare Realtime

**1. The socket will drop, and a dropped KDS socket is a lost ticket.** WebSockets die: WiFi roams, the tablet sleeps, a proxy times out an idle connection, Supabase redeploys. Supabase Realtime's client reconnects, but **reconnection is not resubscription-with-replay** — messages published while disconnected are simply gone. There is no durable log to catch up from. A KDS that misses a `kot.created` event shows a kitchen that is not cooking a dish a guest is waiting for. This is the worst bug in the product and it fails *silently*: nothing on screen indicates the ticket that isn't there.

**2. The connection cap — this is the one that bites.** Verified 2026-07-13 ([Supabase pricing](https://supabase.com/pricing)): **Free = 200 concurrent Realtime connections. Pro = 500** (then $10 per 1 000).

A single busy outlet, during service:

| Client | Sockets |
|---|---|
| KDS screens (hot / cold / bar) | 1–3 |
| POS terminals | 2–4 |
| Captain phones | 3–8 |
| Floor / manager tablet | 1 |
| **Guests with the Booth open** | **10–60** ← the unbounded one |

**A single Saturday-night outlet can approach 50–75 concurrent sockets, and most of them are guests.** Twenty outlets would need thousands — 4–10× Pro's cap, at $10 per extra 1 000. The KDS is not what breaks the budget; **the guest surface is**, and it is the one whose connection count we do not control.

## Decision

**Realtime as the fast path. Heartbeat + polling as the guaranteed path. A sequence-numbered event log as the source of truth. And the Booth does not hold a socket.**

### 1. Every realtime-delivered entity carries a monotonic sequence number

Per outlet: `event_seq bigint`. The client tracks the highest `event_seq` it has processed.

- **Realtime message arrives** → apply it, advance the cursor.
- **Gap detected** (`incoming_seq > last_seq + 1`) → **immediately fetch the missing range over HTTP.** A gap is not an error; it is the normal, expected consequence of a socket blip, and it is handled without the user seeing anything.
- The sequence number is what turns "the socket dropped" from a silent data-loss event into a self-healing one. **This is the whole mechanism.** Without it, no amount of reconnection logic helps.

### 2. Heartbeat + polling fallback

- The KDS pings every **10 s**. Three missed heartbeats (30 s) → **degrade to HTTP polling every 5 s** and show a visible, unmissable **"reconnecting"** state on screen.
- Polling continues until the socket recovers; then it stops. The KDS is *never* silently disconnected — the kitchen either sees live tickets or sees that it is not seeing live tickets.
- **A KDS with a stale connection must look broken.** A screen that shows nothing because it is disconnected is indistinguishable from a screen that shows nothing because there are no orders, and that ambiguity is how a ticket gets lost. **The "last synced 4s ago" indicator is a safety feature, not an affordance.**

### 3. The Booth polls; it does not hold a socket

The guest surface is the unbounded, uncontrollable connection source, so it gets the cheap transport: **HTTP polling every 5 s while the order-status screen is foregrounded, stopping entirely when backgrounded.**

A guest watching their order status does not need sub-second latency; 5 seconds is imperceptible in that context. This one decision removes 60–80% of our peak socket count and keeps us inside the Pro cap for the entire realistic life of the product. **Sockets are reserved for staff surfaces, where the connection count is bounded by the number of employees.**

### 4. Channels are scoped per outlet

`outlet:{id}:kot`, `outlet:{id}:table`. Never global — a global channel would broadcast every restaurant's tickets to every client and exhaust the cap immediately.

## Consequences

- **Positive:** a KDS cannot silently lose a ticket. The sequence-gap check catches it and the polling fallback covers a total socket failure.
- **Positive:** the connection budget is bounded by *staff* count, not *guest* count, which is what makes it forecastable at all.
- **Positive:** the same sequence-numbered event log is what the offline outbox reconciles against on reconnect ([ADR-0004](0004-offline-sync.md)). One mechanism, two problems.
- **Negative:** polling costs Edge Function invocations. 20 outlets × 30 guests × (1 poll / 5 s) × 3 h ≈ **1.3 M invocations/day** at chain scale — well past Pro's 2 M/month. **Mitigation: the poll endpoint is a cached, CDN-friendly GET keyed on `(session, last_seq)`, not an Edge Function invocation per poll**, and it long-polls (holds up to 20 s) rather than returning empty. This must be measured in Phase 5, and it is a real cost risk if we get it wrong.
- **Negative:** two transports to maintain and test. Accepted — the alternative is a kitchen that misses tickets.

## Test

- **Phase 4 gate:** kill the KDS socket for 30 s during active service; fire 5 KOTs during the outage. On reconnect, **all 5 tickets appear**, in order, with correct ages computed from `fired_at` (not from arrival). The screen showed a "reconnecting" state throughout.
- Chaos test in CI: drop the socket at random intervals for 60 s of simulated service; assert zero lost tickets.
