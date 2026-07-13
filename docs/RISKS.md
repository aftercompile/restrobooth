# RestroBooth — Risk Register

**Status:** Phase 0 draft
**Last updated:** 2026-07-13

Ranked by **expected damage**, not by likelihood. R1 and R2 are the two that can kill the project outright, and neither is a technical problem.

---

## R1 — Scope creep from the chain model *(the single biggest threat to this project)*

**Likelihood: high. Impact: fatal. Score: 9/10.**

The brief already warns about this, in its own words: *"Modelling for chains from day one is correct. Building every chain feature before you have one working outlet is not."* That warning is correct and it is also **not self-enforcing.**

Here is the honest failure mode, and it is by far the most likely way RestroBooth dies: the chain model is genuinely interesting. Central kitchen, franchise royalty, inter-GSTIN transfers, staged rollout, cluster dashboards, network benchmarking — these are the fun problems. Billing a table of four correctly, at 9 PM, when the WiFi is down, is not fun. It is fiddly, unglamorous, and it is the entire product. **A project that builds the fun parts first ends up with a beautiful multi-brand franchise-royalty engine and no restaurant using it.**

There is a ten-phase plan here and **the pilot happens at Phase 5**. Phases 6–10 are more than half the plan and none of them are required for a restaurant to run its service.

**Mitigation — and this one is structural, not aspirational:**
- **The single-outlet pilot path in [ROADMAP.md](ROADMAP.md) §2 is the plan of record.** Everything else is a stretch.
- **Phase 8 (central kitchen, royalty) does not begin until a real restaurant has run a real service on RestroBooth.** Not a demo. A service, with real guests and real money. This is a hard gate.
- Chain features are **modelled** in the Phase 1 schema (they are irreversible) and **not built**. The distinction must be defended at every phase review, because the pressure to build them will be constant and it will feel productive.
- **The test: if the pilot restaurant would not notice a feature's absence, it is not v1.** Apply it ruthlessly.

---

## R2 — Swiggy / Zomato partner gating

**Likelihood: certain. Impact: high. Score: 8/10.**

**Verified 2026-07-13.** Neither has open, self-serve APIs.

- **Swiggy** — partner-gated. Public sources confirm the API "can only be accessed by its partners and requires partner credentials"; documentation, staging test accounts, and support are provided to *approved* third-party POS players. **There is no self-serve path.**
- **Zomato** — runs a public [POS Integration developer platform](https://www.zomato.com/developer/integration/) with documented menu-management and order-management APIs and real-time API testing. **Caveat, stated honestly: their site refused my automated fetches (`socket hang up`) on two attempts, so I could not read the eligibility language firsthand.** Secondary sources describe "quick onboarding" for POS developers, which is more open than the brief assumes — but I am not going to assert a partnership requirement, or its absence, on evidence I could not read. **Phase 7 must open the docs in a browser and confirm.**

Either way, **the plan must not depend on getting keys**, and it doesn't.

**Mitigation — value ships before any key exists:**
1. **`MockAggregator`** — a standalone app that looks like a partner dashboard, fires signed webhooks, and simulates rider assignment, rejection, item-out-of-stock, and payout mismatch. Per the brief, this is the highest-leverage thing in the integration phase, and it is a *permanent* piece of test infrastructure, not a stopgap.
2. **`DirectAdapter`** — our own storefront. Zero commission, ships first, needs nobody's permission, and is arguably a better product than the integration.
3. **`ONDCAdapter`** — **the real one we can actually build today.** Verified: ONDC's staging registry is public (`staging.registry.ondc.org`), staging and pre-prod support **direct subscription without DNS validation**, signing is Ed25519, F&B is domain **`RET11`**, and the developer docs are open on GitHub (`ONDC-Official/developer-docs`). Subscriber-ID whitelisting is still required, but there is no commercial partnership gate. **This is the proof that the adapter layer works against a real network, and it is available to us now.**
4. **Manual CSV payout reconciliation** — an owner can upload a Swiggy/Zomato payout CSV and get a mismatch report **without any API at all.** Restaurants are losing real money to unreconciled payouts today. **This may be more valuable than the live integration**, and it has no dependency on anyone.

**Never invent an endpoint.** If we don't have real docs, we code to the interface and build the mock. (Standing rule §9.3.)

---

## R3 — Money math is wrong in production

**Likelihood: medium. Impact: fatal (legal + trust). Score: 8/10.**

A bill that rounds wrong is not a bug, it is a tax exposure and a dead customer relationship. The dangerous cases are the ones nobody tests: the paisa-level split between CGST and SGST, a bill-level discount across two tax classes, a three-way split with an odd remainder, the round-off boundary at exactly ₹0.50.

**Mitigation:**
- `packages/domain` is **pure, dependency-free, and 100% covered** on line and branch. Every worked example in [DOMAIN.md](DOMAIN.md) §7 is a fixture.
- **The database refuses to store a wrong bill.** `totals_reconcile` and `payable_is_whole_rupees` are `check` constraints ([ERD.md](ERD.md) §4). Money math is guarded by Postgres, not merely by tests — an incorrectly computed bill is *unpersistable*.
- **Property-based tests** (fast-check) on the money functions: for any basket, any discount, any tax mix — `Σ tax components == bill.tax_paise`, `payable % 100 == 0`, `Σ split taxables == subtotal`, and no negative payable.
- The same pure functions run on client and server; a disagreement is **alarmed**, never silently reconciled.

---

## R4 — Offline sync produces a duplicate bill

**Likelihood: medium. Impact: severe. Score: 7/10.**

The specific nightmare: the network returns, the outbox replays, and a table is billed twice — or an invoice number is reused across two terminals. This is the class of bug that destroys trust in a POS permanently, and it is very hard to fix after the fact because the bad data is already in the tax return.

**Mitigation:** [ADR-0004](adr/0004-offline-sync.md), plus one structural guarantee worth repeating: **overlapping invoice-number blocks are impossible at the database level** (`exclude using gist` on `invoice_number_blocks`, [ERD.md](ERD.md) §5). Two terminals cannot be issued the same number even if the application logic is wrong. Correctness here is enforced by Postgres, not by careful code.

Plus: idempotency keys on every mutation; bills immutable once finalised; **genuine duplicates flag for a manager and are never auto-resolved** — money is not a thing you silently merge.

**The Phase 3b gate is adversarial:** kill the network mid-service, bill four tables, reconnect *twice* with an interleaved second terminal, assert zero duplicates and zero lost items.

---

## R5 — A KDS silently loses a ticket

**Likelihood: medium-high. Impact: severe. Score: 7/10.**

A socket drops, a `kot.created` event is published into the void, and the kitchen never sees the ticket. It fails **silently**: a screen with a missing ticket looks exactly like a screen with no orders. A guest waits 40 minutes for food nobody is cooking.

**Mitigation:** [ADR-0005](adr/0005-realtime-transport.md). Monotonic `event_seq` per outlet; a gap triggers an immediate HTTP backfill; heartbeat every 10 s; degrade to polling after 30 s with a **visible, unmissable "reconnecting" state**. **A disconnected KDS must look broken** — the ambiguity between "no orders" and "not receiving orders" is the actual bug.

---

## R6 — RLS is slow, or RLS is wrong

**Likelihood: medium. Impact: severe. Score: 6/10.**

Two failure modes, and they need different answers:

- **Slow:** the `SECURITY DEFINER` lookup evaluated per-row on a 9 M-row partition. Mitigation: **BENCH-01**, run in Phase 1 *before* anything is built on it, with a documented escalation ladder. The `STABLE` + `(select …)` InitPlan hoist is the crux and it is explicitly benchmarked against the naive form.
- **Wrong:** a policy that leaks across tenants. In a shared multi-tenant DB, one bad policy exposes every restaurant's data to every other. **This is the one that ends the company.** Mitigation: the **15-case adversarial suite** in [TENANCY.md](TENANCY.md) §6 runs against real Postgres in CI, as real roles. Note especially **A8** (brand isolation *within* a shared cloud-kitchen outlet — outlet-scoping alone is not enough) and **A15** (the access function must not be an information-disclosure oracle for other users' scopes). **Types cannot prove RLS works; only a real query as a real role can.** Add RLS fuzzing in Phase 10.

---

## R7 — Free-tier ceilings hit mid-pilot

**Likelihood: certain (it is a *when*). Impact: medium. Score: 5/10.**

Verified: Vercel Hobby is **non-commercial only**, and its own definition of commercial usage includes *"any method of requesting or processing payment from visitors of the site"* — which is **exactly what the Booth does at Phase 5**. Supabase Free is 500 MB (we exceed it), pauses after a week, and caps Realtime at 200 concurrent connections.

**Mitigation:** [ADR-0001](adr/0001-hosting.md) names the trigger (**Phase 5**, not "first paying customer") and the cost (**~$45/mo**: Supabase Pro $25 + Vercel Pro $20/seat). The escape-hatch rule — *no Supabase- or Vercel-specific API may be called from `packages/domain` or from any UI component* — is what keeps this a scheduling fact rather than a lock-in problem. **This risk is scored 5 not because it is unlikely but because it is cheap and fully understood.**

---

## R8 — The design lands as a template

**Likelihood: medium. Impact: medium-high. Score: 5/10.**

"The interface is designed, not assembled from a dashboard template" is one of the four reasons this product exists. If the UI reads as default shadcn, or as one of the current AI-design tells (cream + serif + terracotta; near-black + acid green; glassmorphism; purple→blue gradient hero), then **one of the four differentiators is simply gone** — and it is the one a prospective customer judges in the first four seconds.

**Mitigation:** [DESIGN.md](DESIGN.md) — three directions, critiqued explicitly against the banned list, one chosen at the gate. Standing rule §9.9: screenshot the UI and critique it before showing it. **If it looks like a template, it is a template.** The signature element is the test: if you can't name it in one sentence, there isn't one.

---

## R9 — The AI layer is slow, expensive, or embarrassing in front of a guest

**Likelihood: medium. Impact: medium. Score: 4/10.**

A guest scans a QR code and waits 3 seconds for a "Picked for you" rail that recommends a dish the kitchen has 86'd. Or the token bill for a busy Saturday is a genuine line item.

**Mitigation:** [ADR-0007](adr/0007-ai-provider.md). Deterministic math in SQL, LLM for prose only. Hard 1200 ms timeout on the guest path. **The menu never waits on AI.** Per-outlet budget guard enforced *before* the call. Response cache keyed on the preference-vector hash (a ~4-dimension intake means a very high hit rate, which is what makes per-guest AI affordable at all). Availability is resolved live, so an 86'd dish cannot be recommended. **Phase 6 gate: turn the AI off and demo that everything still works.**

---

## R10 — Printing is the thing that actually breaks on day one

**Likelihood: high. Impact: medium. Score: 4/10.**

Underrated, and it is invariably what a real deployment trips on. ESC/POS thermal printers are a zoo: different vendors, different code pages (and **Indian-language receipts are a genuine escape-sequence problem**), USB vs LAN vs Bluetooth, and a print bridge running on a counter PC that someone will unplug. Browser printing cannot do KOTs, so there is a native-ish component in an otherwise web product — the one place the "it's all just a PWA" story breaks.

**Mitigation:**
- The **print bridge is a tiny, boring, well-tested Node service** on the counter machine, exposed over LAN. It is a queue, not a passthrough.
- **A KOT with no printer ACK within 10 s raises an alarm on the POS.** A silently-failed KOT is the same bug as R5 with a different transport — and the same rule applies: **it must look broken.**
- The KDS is the **fallback for a dead printer**, and this is a real argument for kitchens having a screen even if they prefer paper.
- **Test against real hardware early** — buy one cheap thermal printer in Phase 3a. Do not discover the code-page problem during a pilot.
- KOT print jobs are queued and idempotent, so a bridge restart does not reprint the day's tickets.

---

## Watch list — not top-10, but do not forget

- **Terminal data at rest.** IndexedDB holds bills and guest PII. A lost tablet is a breach. Encrypt, short-retain (current business day only), remote-wipe on deactivation. ([ADR-0004](adr/0004-offline-sync.md) consequences.)
- **QR token replay.** Signed, rotating, per-table tokens — and the Booth is anonymous, so the token *is* the auth. Test replay and token-sharing (a guest who screenshots the QR and orders from home).
- **Clock skew on terminals.** Mitigated by never taking `business_date` from the client, but worth a test.
- **Service charge legality.** CCPA (2022) prohibits automatic/mandatory levy. We model it off-by-default and one-tap removable; the restaurant's counsel owns the decision.
- **The food-court gap.** [TENANCY.md](TENANCY.md) §2 Case B — an outlet whose landlord runs the cashier is not modellable today. Accepted, documented, additive to fix.
