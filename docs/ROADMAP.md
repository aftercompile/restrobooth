# RestroBooth — Roadmap

**Status:** Phase 0 draft
**Last updated:** 2026-07-13

Every phase ends with a **runnable demo**, an updated `PROGRESS.md`, and an **explicit approval gate**. Phase N+1 does not start without sign-off on Phase N.

---

## 1. The rule that governs this roadmap

> **Model the irreversible things now. Sequence the features so a single real restaurant can pilot RestroBooth by the end of Phase 5.**

**Irreversible → Phase 0/1, non-negotiable:** tenancy hierarchy, outlet-vs-store split, membership/RLS model, override matrix, GSTIN-scoped numbering series, partitioning and retention.

**Everything else can wait, and should.** See [RISKS.md](RISKS.md) R1 — scope creep from the chain model is the single most likely way this project dies.

---

## 2. The single-outlet pilot path ⭐

**The cut line.** This is the plan of record; everything outside it is a stretch goal.

```
Phase 1  Foundation ────────── schema, RLS, seed. The chain model is BUILT but DORMANT.
Phase 2  Menu ──────────────── override resolver. Single-outlet uses ONE store. Governance is
                               there, but HQ and the outlet are the same person.
Phase 3a Ordering, tables, KOT
Phase 3b Billing, day close, OFFLINE ← the crown jewels. Go slow.
Phase 4  KDS
Phase 5  Booth ─────────────── QR → order → pay → feedback
         ══════════════════════════════════════════════════════
         ▶ PILOT. A real restaurant runs a real service. Real guests. Real money.
         ══════════════════════════════════════════════════════
Phase 6  AI v1                 } everything past the line is
Phase 7  Channels              } a stretch, and is gated on
Phase 8  Inventory + CK        } the pilot actually working
Phase 9  Reports + AI v2       }
Phase 10 Hardening             }
```

**Hard gate: Phase 8 (central kitchen, franchise royalty) does not begin until a real restaurant has run a real service.** Not a demo — a service.

**The test for whether something belongs in v1: would the pilot restaurant notice its absence?** If no, it is not v1. Apply this ruthlessly; the pressure to build the interesting chain features will be constant and will feel productive.

---

## 3. Phases

### Phase 1 — Foundation *(carries the chain model — budget more time)*

**Build:** Turborepo monorepo. Supabase project. Full schema + migrations ([ERD.md](ERD.md)) including the `org → gst_registration → brand → store → outlet → terminal` hierarchy and the `memberships` scope model. RLS policies on every table. CI. Design tokens + the first 10 UI primitives.

**First task, before anything else: run [BENCHMARKS.md](BENCHMARKS.md).** BENCH-01 (RLS) and BENCH-02 (override resolution) confirm or revise two provisional ADRs. **A provisional ADR still provisional at the end of Phase 1 is a process failure.**

**Seed data is a chain, not a restaurant:** 1 org, 2 brands, **3 outlets across 2 states** (so IGST and dual-GSTIN are exercised from day one), one of which is a **cloud kitchen where both brands share a single physical outlet**. A realistic 120-item Indian menu with variants, add-ons, and tax classes. ⚠️ Size the order history to fit Supabase Free's 500 MB ([ADR-0001](adr/0001-hosting.md)) — seed weeks, not years.

**Acceptance:**
- [ ] The **15-case adversarial RLS suite** ([TENANCY.md](TENANCY.md) §6) passes against real Postgres, as real roles. **Especially A8** (brand isolation inside the shared cloud kitchen) and **A15** (the access function is not an oracle).
- [ ] BENCH-01 and BENCH-02 have run; both ADRs are CONFIRMED or REVISED in writing.
- [ ] `pnpm seed` produces a believable chain including the shared-kitchen case.
- [ ] Partitions exist three months ahead; CI asserts it.

**Demo:** Log in as each role at each scope and watch the boundary hold. Log in as the brand-A manager at the cloud kitchen and try to read brand B's orders — **same outlet, and it must fail.**

---

### Phase 2 — Menu *(the override matrix lives or dies here)*

**Build:** Categories, items, variants, add-on groups with min/max rules, item-level tax class, images, bulk CSV import. Then the hard part: the **store → channel → daypart → promo** resolver as sparse overrides, with a single resolver function. Effective-dated pricing. Draft → approve → publish. Staged rollout to an outlet group. Item 86'ing scoped to a **store**, propagating in real time.

**Acceptance:**
- [ ] **The 21-row precedence table ([TENANCY.md](TENANCY.md) §7.4) passes exhaustively.** Rows 8, 12, 17, 21 are the ones a naive implementation fails. **Row 17 especially: an 86 must not erase a price override — price and availability resolve independently.**
- [ ] All menu reads go through **one function** (`resolveMenu()`), so ADR-0006's escalation ladder has exactly one call site to change.
- [ ] A cashier cannot change a price. (Capability test.)

**Demo:** Change a price at brand level; watch it land on two outlets but not the third (which has an override). Schedule a price change for tomorrow; prove it fires **with no cron job**. 86 an item and watch it grey out on the Booth in real time.

---

### Phase 3a — Ordering, Tables, KOT

**Build:** Floor / area / table model. Table sessions. Order capture (POS + captain). KOT generation and routing (hot / cold / bar printers). KOT reprint. Item void with reason + manager auth. Table merge / split / move. Live floor map over Realtime.

**Acceptance:**
- [ ] A **reprint does not create a second KOT** — it increments `reprint_count` and writes a print event. (The "KOT printed twice" bug.)
- [ ] A void after fire requires manager auth + a reason code and writes an audit row. A cashier cannot do it.
- [ ] **A KOT with no printer ACK in 10 s alarms on the POS.** A silently-failed KOT must look broken.
- [ ] Merge is blocked across stores (you cannot merge two brands' orders into one bill).
- [ ] ⚠️ **Buy a real thermal printer.** Do not discover the code-page problem during a pilot ([RISKS.md](RISKS.md) R10).

**Demo:** Seat a table, take an order from the captain app, watch the KOT print and the floor map update.

---

### Phase 3b — Billing, Payments, Day Close *(the crown jewels — go slow)*

> ## ⏸ BLOCKED UNTIL: offline conflict rules are approved
> [DOMAIN.md](DOMAIN.md) §8 is **PARKED** — sign-off deferred as of 2026-07-13. **Offline-first billing is still in scope; only the approval is pending.**
>
> **It must be approved before this phase starts.** The conflict rule per entity determines that entity's **schema** (append-only vs. mutable), so discovering it during implementation is a migration, not a patch.
>
> **Phases 1, 2, 3a and 4 are unaffected and proceed normally.**

**Build:** Bill generation. GST / CGST / SGST. Discounts (item, bill, %, flat, coupon). Service charge. Packaging. Round-off. **Split bill (item / amount / guest)**. Split tender. Void / refund with audit and credit note. Cash drawer. **Day Open / Day Close** with reconciliation. GST-compliant invoice print. **Offline-first mode with outbox sync.**

**Acceptance:**
- [ ] **`packages/domain` at 100% line and branch coverage on money math.** Every worked example in [DOMAIN.md](DOMAIN.md) §7 is a fixture. Property-based tests on the invariants.
- [ ] **The adversarial offline test:** kill the network mid-service, bill four tables, reconnect **twice** with an interleaved second terminal. Assert **zero duplicate bills, zero lost order items, zero duplicate KOTs, and no invoice-series gap that isn't in the gap register.**
- [ ] The DB **refuses to store a wrong bill** (`totals_reconcile`, `payable_is_whole_rupees` fire).
- [ ] Invoice numbers ≤ 16 chars, unique + sequential per GSTIN per FY.
- [ ] Cannot bill without an open business day.
- [ ] The gap register explains every gap.

**Demo:** Kill the network mid-service, bill four tables, reconnect — everything reconciles, zero duplicates.

---

### Phase 4 — KDS

**Build:** Ticket rail, aging colour states, section filtering, bump / recall, prep-time tracking, ticket-time anomaly flag. Heartbeat + polling fallback ([ADR-0005](adr/0005-realtime-transport.md)).

**Acceptance:**
- [ ] **Kill the socket for 30 s during service; fire 5 KOTs during the outage. All 5 appear on reconnect**, in order, with ages computed from `fired_at` (not arrival).
- [ ] A disconnected KDS **looks broken** — visible "reconnecting" state. No ambiguity between "no orders" and "not receiving orders."
- [ ] Readable at 2 metres. Test it by standing 2 metres away.

**Demo:** Readable across the room; survives a 30-second disconnect without losing a ticket.

---

### Phase 5 — The Booth ⭐ *(pilot-ready after this)*

**Build:** Signed per-table QR tokens (rotating, replay-proof). Anonymous guest session. The menu experience. Cart. Add-to-table-order. Call waiter. Live order status (**polling, not sockets** — [ADR-0005](adr/0005-realtime-transport.md) §3). Pay-at-table (UPI intent deep-link + gateway). Post-meal feedback.

⚠️ **[ADR-0001](adr/0001-hosting.md): this phase triggers the move to Vercel Pro + Supabase Pro (~$45/mo).** Taking a payment from a guest is commercial use by Vercel's own definition. Budget for it now.

**Acceptance:**
- [ ] **Booth LCP < 2.0 s on 4G, cold cache.**
- [ ] QR token replay is rejected. A screenshotted QR used from off-premises is rejected.
- [ ] A guest completes scan → order → pay without asking a human.
- [ ] Payments: **Razorpay webhooks verified via HMAC-SHA256 over the raw body, `X-Razorpay-Signature`** (verified 2026-07-13). Idempotent on `(gateway, gateway_txn_id)`.
- [ ] **UPI intent deep-link** (`upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…&tr=…`, NPCI linking spec) works as the zero-cost fallback.
- [ ] Cash and "pay at counter" are first-class, not afterthoughts.

**Demo:** Scan → order → KOT prints in the kitchen → pay → feedback lands in the DB. **End to end on a real phone.**

> ### ▶ PILOT GATE
> **A real restaurant runs a real service on RestroBooth.** Everything below is gated on this actually happening.

---

### Phase 6 — AI Layer v1

**Build:** The Booth Host (§5A), smart upsell (§5E), review→action (§5B). Provider abstraction, budget guard, cache, graceful degradation, and an **eval harness** — fixed guest-preference scenarios with expected-quality assertions, so recommendation quality is measurable and not vibes.

**Acceptance:**
- [ ] **Turn the AI provider off. Every surface still works.** This is the gate.
- [ ] The menu never waits on AI (1200 ms hard timeout; the rail slides in late or not at all).
- [ ] The shortlist is **deterministic** (vector + rules in SQL); only the prose is generated. This is what makes the eval harness possible.
- [ ] An 86'd dish is never recommended.
- [ ] Per-outlet budget guard enforced **before** the call.

**Demo:** Two guests with different stated preferences get visibly, defensibly different menus. Then kill the AI and show the app is fine.

---

### Phase 7 — Channels

**Build:** `ChannelAdapter` interface. The **MockAggregator simulator** (the highest-leverage thing here — a permanent piece of test infrastructure). `DirectAdapter` (own storefront). Menu push, stock sync, order ingestion with idempotency, order-state round-trip, payout reconciliation with mismatch report. **ONDC staging integration** (`RET11`, Ed25519, `staging.registry.ondc.org`).

⚠️ **Confirm Zomato's eligibility terms by opening the docs in a browser** — I could not fetch them ([RISKS.md](RISKS.md) R2). Swiggy is partner-gated with no self-serve path; build to the interface, ship behind a flag, submit the partner request in parallel.

**Acceptance:**
- [ ] **Manual CSV payout reconciliation works with no API at all** — this delivers value before any key exists, and may be worth more than the live integration.
- [ ] Webhook replay is idempotent (same `idempotency_keys` table as offline sync).
- [ ] **No invented endpoints anywhere.** Standing rule §9.3.

**Demo:** An order fired from the simulator lands on POS and KDS as a delivery order, is accepted, and reconciles in the payout report.

---

### Phase 8 — Inventory, Recipes, Purchasing, Central Kitchen

> **Gated on the pilot. Do not start this before a real restaurant has run a real service.**

**Build:** Stock items, units + conversions, recipes/BOM, semi-finished goods, auto-deduction on bill settle, wastage, stock take with variance, low-stock alerts, vendors, POs, per-location costing, food-cost %. Then: central kitchen (indent → transfer order → dispatch → receive-with-variance), inter-outlet transfers, **inter-GSTIN transfers flagged as taxable supplies**. Franchise royalty.

**Demo:** Sell a biryani at Outlet 2. The gravy base deducts from the central kitchen's dispatched stock; rice and packaging deduct locally; and the food-cost % differs between outlets — **partly because vendor prices differ, and partly because the inter-state transfer carried 5% IGST that a no-ITC restaurant cannot reclaim** ([DOMAIN.md](DOMAIN.md) §7.5). Telling an owner *that* is the feature.

---

### Phase 9 — Reports & AI v2

**Build:** The report suite (day-end, item-wise, category-wise, hourly heatmap, staff performance, discount audit, tax summary per GSTIN, **gap register**, channel P&L) — each with **outlet / cluster / brand / org roll-up**, since every report in a chain is really four reports. All reading the **rollup layer** ([ADR-0002](adr/0002-data-retention.md)), never raw partitions.

Then: menu engineering (§5C), forecasting (§5D — **the honest statistical baseline, labelled with its confidence; do not fake ML**), Ask RestroBooth (§5F, read-only allowlisted views, outlet scoping injected server-side, **a prompt is not a security boundary**), Content Studio (§5G), and **Network Benchmarking (feature H)** — the outlet-vs-network comparison that is the whole reason this beats PetPooja.

**Demo:** Ask *"which dishes should I take off the menu, and is it every outlet or just some?"* and get an answer with the numbers, the ticket times, and the review quotes behind it.

---

### Phase 10 — Hardening & Launch

Perf budget (POS < 100 ms, Booth LCP < 2 s on 4G). Load test. A11y audit. Security review: **RLS fuzzing**, QR token replay, webhook signature verification, **PII on terminal IndexedDB** ([ADR-0004](adr/0004-offline-sync.md) — encrypt, short-retain, remote-wipe; easy to forget). Backup/restore drill. **Cold-partition re-attach drill** — rehearse it before an auditor asks. Onboarding flow, demo tenant, docs.

---

## 4. What gets cut first

If time runs short, in order:

1. Franchise royalty (Phase 8)
2. Central kitchen (Phase 8) — model stays, feature goes
3. Network benchmarking (Phase 9)
4. Content Studio, forecasting (Phase 9)
5. ONDC (Phase 7) — the mock + DirectAdapter + CSV reconciliation carry the value

**Never cut:** offline billing, money-math coverage, the RLS adversarial suite, KDS ticket-loss protection. Those four are the product.
