# RestroBooth — Product Requirements

**Status:** Phase 0 draft, pending approval
**Last updated:** 2026-07-13

---

## 1. What this is

A cloud restaurant operating system for the Indian F&B market: billing and POS, table and floor management, menu and recipe management, kitchen display, captain ordering, QR-based guest ordering and payment, inventory, delivery-aggregator order ingestion, and an AI layer that sits on top of all of it.

Feature parity target: PetPooja POSS. The four places we intend to beat it are the product thesis, and if we cannot hold them, RestroBooth has no reason to exist:

1. **AI is native, not a module.** Guest taste concierge, menu engineering, review→action, forecasting, NL analytics, and cross-outlet benchmarking.
2. **The guest surface is a product**, not a PDF behind a QR code.
3. **The interface is designed**, not assembled from a dashboard template.
4. **Billing works offline.** A POS that dies with the WiFi is not a POS.

Scope is settled: **multi-outlet, multi-brand chains from day one**, shared multi-tenant with Postgres RLS. See [TENANCY.md](TENANCY.md).

---

## 2. Surfaces

| Surface | User | Device | Core need | Density |
|---|---|---|---|---|
| **POS** | Cashier, manager | Tablet / desktop | Speed. Keyboard-first. Zero latency. Works offline. | Dense, no motion |
| **Floor** | Manager, host | Tablet | Table state at a glance; merge / split / move | Dense, minimal motion |
| **KDS** | Kitchen | Mounted screen | Readable at 2 m. Ticket aging. One gesture: bump. | Dense, no motion |
| **Captain** | Waiter | Phone (PWA) | Take order at table, fire KOT, call for bill | Dense, touch-first |
| **Booth** | Diner | Own phone (QR) | Browse, get guided, order, pay, give feedback | Generous, cinematic |
| **Console** | Owner, HQ | Desktop | Menu, inventory, reports, AI insight, multi-outlet | Editorial, calm |

One design system, three densities. See [DESIGN.md](DESIGN.md).

---

## 3. Personas

- **Cashier** — high volume, low patience, works a 10-hour shift on one screen. Never touches a mouse if a key will do. Cannot change a price. Cannot void without a manager.
- **Captain / waiter** — phone in one hand, plates in the other. Needs the order fired in under 15 seconds from tableside.
- **Kitchen** — reads the screen from across a hot line. Needs one gesture. Cannot afford a lost ticket, ever.
- **Outlet manager** — opens and closes the day, authorises voids and discounts, reconciles the drawer, answers for the variance.
- **Cluster / area manager** — owns a *subset* of outlets. Compares them. Must not see the outlets they don't own.
- **Owner / HQ** — sets menu and price centrally, watches margin, wants the answer, not the report.
- **Diner** — has scanned a QR code, is hungry, and will abandon in 8 seconds if the menu doesn't paint.

---

## 4. Scope: v1 vs later

**v1 — the single-outlet pilot (Phases 1–6).** The cut line: one real restaurant runs its actual service on RestroBooth.

- Tenancy, memberships, RLS, roles
- Menu: categories, items, variants, add-on groups, tax classes, images, the override resolver
- Floor, tables, table sessions, merge / split / move
- Order capture (POS + captain), KOT generation, routing, reprint, void with reason + manager auth
- Billing: GST, discounts, service charge, packaging, round-off, split bill (item / amount / guest), split tender
- Day open / day close with cash reconciliation
- Offline-first billing with outbox sync and reserved invoice-number blocks
- KDS with heartbeat + polling fallback
- Booth: signed rotating QR, guest session, menu, cart, order, pay (UPI + gateway), feedback
- AI v1: Booth Host, smart upsell, review→action

**Modelled in v1, built later.** These are in the schema from Phase 1 because they are irreversible, but no feature ships against them until the phase named:

- Central kitchen / commissary, indents, transfer orders, inter-GSTIN transfers *(Phase 8)*
- Franchise royalty *(Phase 8)*
- Staged menu rollout to outlet groups, draft→approve→publish governance *(Phase 2 partially, full in Phase 8)*
- Cluster / brand / org report roll-ups *(Phase 9)*
- Network benchmarking *(Phase 9)*

**Explicitly not in v1**

- Swiggy / Zomato live integration (partner-gated — see [RISKS.md](RISKS.md) R1; we ship the mock, the DirectAdapter, and manual CSV payout reconciliation instead)
- Native mobile apps (captain is a PWA — see [OPEN-DECISIONS.md](OPEN-DECISIONS.md) §10.7)
- Payroll, attendance, table reservations, waitlist
- Multi-currency (INR only; the money type is generic but no FX)

---

## 5. Success criteria

These are the numbers the product is judged on. They are testable and they appear in the phase gates.

**Correctness — non-negotiable, any failure is a P0**
- Zero duplicate bills after an offline period, under adversarial reconnect (kill network mid-settle, reconnect twice, replay the outbox).
- Zero lost KOTs across a 30-second socket drop on the KDS.
- Invoice numbers unique and consecutive per GSTIN per financial year, with every gap explained by a row in the gap register.
- `packages/domain` at 100% line and branch coverage on money math. No float arithmetic anywhere in the ledger path.
- Adversarial RLS suite passes: a cluster manager cannot read a sibling cluster; a franchisee cannot read a sibling franchisee. See [TENANCY.md](TENANCY.md) §6.

**Performance**
- POS interaction latency < 100 ms p95 (keypress → visible state change), offline or online.
- Booth LCP < 2.0 s on a 4G connection, cold cache. The menu paints before the AI rail resolves, always.
- KDS ticket appears within 2 s of KOT fire, p95.
- Bill finalise → print < 1.5 s.

**Product**
- A guest completes scan → order → pay without asking a human for help.
- Two guests with materially different stated preferences get visibly, defensibly different menus.
- Turn the AI provider off: every surface still works. The AI rail simply does not render.

---

## 6. Hard product rules

Carried from the brief, restated here because they are requirements, not implementation notes. Each is elaborated in [DOMAIN.md](DOMAIN.md).

- **KOT ≠ Bill.** Separate lifecycles, separate numbering, separate reprint semantics.
- **Business day ≠ calendar day.** Every order and bill carries a `business_date` set by an explicit Day Open ritual.
- **Money is server-authoritative and integer.** Paise, never floats. **The AI never touches the ledger.**
- **Idempotency everywhere.** Every mutation carries a client-generated key. Webhooks, payment callbacks, and offline sync all replay.
- **RLS is the security model.** Enforced in Postgres, not in the app.
- **A cashier never changes a price.** HQ does, through a governed publish flow, and it is audited.
