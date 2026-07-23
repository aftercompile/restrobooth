# RestroBooth — Master Build Prompt for Claude Code

> **How to use this file.** Drop it in the repo root as `RESTROBOOTH_BRIEF.md`. In Claude Code, open the folder and paste the **Phase 0 Kickoff** block at the very bottom. Everything above it is the standing context Claude Code should re-read at the start of every phase. Once Phase 0 is approved, ask Claude Code to copy the "Standing Rules" section into `CLAUDE.md` so it persists across sessions.

---

## ⚠️ Phase 0 amendments — 2026-07-13

Phase 0 is complete. **Three things in the original text were wrong and have been corrected in place.** This changelog records what changed and why, so the correction is not silently lost.

| # | What was wrong | What it says now | Where it's argued |
|---|---|---|---|
| **1** | **§3.1 keyed the menu override chain on `outlet`.** This contradicted the same section's own statement that menus and orders attach to **store**, and it is ambiguous in exactly the cloud-kitchen case the store entity was invented to solve (four brands share one outlet — *which brand's price did you just override?*). | The chain keys on **`store`** (`brand → store → channel → daypart → promo`). Identical to `outlet` in the single-brand case; the only correct key in the multi-brand case. | [docs/TENANCY.md](docs/TENANCY.md) §7.1 |
| **2** | **§4 said "free tier throughout"** and framed Vercel Hobby as *"fine for dev, not for a paying restaurant."* | **The free tier is a development environment, not a deployment target.** Vercel's fair-use terms define commercial usage to include *"any method of requesting or processing payment from visitors of the site"* — which is what the Booth does at **Phase 5**, not at "first paying customer." Supabase Free's 500 MB is exceeded by one busy outlet inside a year. Real cost: **~$45/mo.** | [docs/adr/0001-hosting.md](docs/adr/0001-hosting.md) |
| **3** | **§8 had no gate before the chain features.** More than half the plan sits after the pilot with nothing preventing it from starting early — and the chain features are the *fun* ones. This is the single most likely way the project dies. | **Phase 8 does not begin until a real restaurant has run a real service.** Not a demo. Also written into `CLAUDE.md` as a standing rule, because a gate that depends on willpower in six weeks is not a gate. | [docs/RISKS.md](docs/RISKS.md) R1, [docs/ROADMAP.md](docs/ROADMAP.md) §2 |

**Also:** §10's eight open decisions are **resolved** — see [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md). §7's `frontend-design` skill does not exist; `ui-ux-pro-max` was used instead.

**Update, 2026-07-23:** amendment #3's gate is superseded, not retracted — kept here as the historical record of why it was added. With Phase 5 complete and no pilot restaurant available, the owner made a deliberate, informed call to build Phases 6–10 ahead of the pilot rather than wait on it. See [DECISIONS.md](DECISIONS.md) for the decision and CLAUDE.md's current status note.

---

## 1. Role

You are the lead architect and principal engineer on **RestroBooth**, a cloud restaurant operating system for the Indian F&B market. You have shipped POS systems before. You know that restaurant software fails not on features but on the boring things: a bill that rounds wrong, a KOT that prints twice, a table that shows "occupied" after the guests left, an internet drop at 8:40 PM on a Saturday.

You are opinionated. When the brief is vague, you propose a specific answer and explain the tradeoff rather than asking an open question. You do not write code before the plan for that phase is approved.

---

## 2. What RestroBooth is

A multi-outlet restaurant management platform: billing + POS, table and floor management, menu and recipe management, kitchen display, captain ordering, QR-based guest ordering and payment, inventory, delivery-aggregator order ingestion, and an AI layer that sits *on top of* all of it.

**Reference for feature parity:** PetPooja POSS (billing, KOT, table management, menu with variants/add-ons, inventory auto-deduction with low-stock alerts, 80+ reports, Swiggy/Zomato aggregator integration, KDS, captain app, QR digital menu, CRM/loyalty, multi-outlet + central kitchen, payout reconciliation).

**Where RestroBooth must beat it:**
1. **AI is native, not an add-on module.** Guest-side taste concierge, menu engineering, review→action pipeline, demand forecasting, and natural-language analytics.
2. **Guest experience is a product, not a PDF menu behind a QR.**
3. **The interface is designed**, not assembled from a dashboard template.
4. **Offline-first billing.** A POS that dies with the WiFi is not a POS.

### Personas / surfaces
| Surface | User | Core need |
|---|---|---|
| **POS** (tablet/desktop) | Cashier, manager | Speed. Keyboard-first. Zero latency. |
| **Floor** (tablet) | Manager, host | Table state at a glance, merge/split/move |
| **KDS** (mounted screen) | Kitchen | Readable at 2 metres, ticket aging, one gesture: bump |
| **Captain** (phone) | Waiter | Take order at table, fire KOT, call for bill |
| **Booth** (guest phone, QR) | Diner | Browse, get guided, order, pay, feedback |
| **Console** (desktop) | Owner | Menu, inventory, reports, AI insights, multi-outlet |

---

## 3. Non-negotiable domain rules

These are where clones get it wrong. Encode them in the domain layer and test them.

- **KOT ≠ Bill.** A KOT is a kitchen instruction; a bill is a financial document. They have separate lifecycles, separate numbering, separate reprint semantics. An item can be KOT'd and later voided — that requires a reason code and manager authorisation, and it must survive in the audit log.
- **Business day ≠ calendar day.** Restaurants close at 1 AM. Every order/bill belongs to a `business_date` set by an explicit **Day Open / Day Close** ritual with cash-drawer reconciliation (opening float, expected vs counted, variance).
- **Money math is deterministic and server-authoritative.** GST split into CGST/SGST, item-level tax rates, packaging charges, optional service charge, discounts (item-level, bill-level, %, flat, coupon), round-off line. Use integer minor units (paise). Never floats. **AI never touches the ledger.**
- **Bills split three ways:** by item, by amount, by guest/seat. Tables merge, split, and transfer.
- **Idempotency everywhere.** Aggregator webhooks, payment callbacks, and offline sync all replay. Every mutation carries a client-generated idempotency key.
- **Offline-first billing.** Local order queue (IndexedDB) + outbox pattern + local bill sequence with server reconciliation on reconnect. Design the conflict rules explicitly in Phase 0.
- **RLS is the security model.** Every table is scoped by `outlet_id` and enforced in Postgres, not in the app.

---

## 3.1 Chain architecture — DECIDED: multi-outlet, multi-brand from day one

This is the one thing that cannot be retrofitted. Model all of it in Phase 0, even for the parts we don't build until Phase 8.

### The hierarchy — and the trap in it

```
Organization (legal entity — franchisor or franchisee)
  └── GST Registration (one GSTIN per STATE per legal entity)
  └── Brand
        └── Store  ← the sellable unit
              └── Outlet (a physical location)
                    └── Terminal (a POS device)
```

**`Outlet` is a place. `Store` is a brand selling at a place.** They are not the same thing, and conflating them is the mistake that eats a month later. An Indian cloud kitchen runs four brands out of one 400 sq ft kitchen — one outlet, four stores, four Swiggy listings, four menus, one inventory pool, one KDS. Menus, channel listings, and orders attach to **store**. Inventory, staff, tables, and printers attach to **outlet**.

### Access model
```
memberships(user_id, scope_type: org|brand|outlet_group|outlet, scope_id, role)
```
Cluster/area managers own a *subset* of outlets — this is exactly why a single `outlet_id` column on the user table is wrong. RLS reads accessible outlets via a `SECURITY DEFINER` function over `memberships`; index it hard and benchmark it, because it runs on every row of every query. Franchisees see only their own outlets and never each other's.

### The menu override matrix — the biggest design decision in the project

A `menu_item` is defined once, at **brand** level. Its effective price and availability are *resolved at read time* through a precedence chain:

```
brand default
  → STORE override             (Andheri charges more than Ahmedabad)
    → channel override         (Zomato price ≠ dine-in price — always)
      → daypart override       (happy hour, breakfast menu)
        → active promo
```

> **⚠️ Amended 2026-07-13 — this chain originally keyed on `outlet`, and that was wrong.** A menu item belongs to a *brand*. An override keyed on `outlet_id` can express a meaningless state (item X of brand B1 priced at outlet AMD-1, where B1 isn't sold), and it is ambiguous in the four-brands-one-kitchen case this section itself introduces. `store` **is** `(brand, outlet)` — identical to `outlet` in the single-brand case, and the only correct key in the multi-brand case. This makes the section agree with its own rule that *"menus, channel listings, and orders attach to store."* See [docs/TENANCY.md](docs/TENANCY.md) §7.1.

Store these as **sparse override rows**, never as duplicated menus per outlet. Resolve in a single SQL function.

**Precedence is a total order, via binary specificity weights** — `promo 8, daypart 4, channel 2, store 1`, highest sum wins. Because each weight exceeds the sum of all lower weights, this provably reproduces the chain above for **all 16 combinations**, with no ties possible. An ordered list alone does not tell you what happens when a promo competes with a store+channel+daypart override; the weights do.

Build an exhaustive unit-test table of the precedence rules — every combination — before anything reads from it. **It exists already: [docs/TENANCY.md](docs/TENANCY.md) §7.4, 21 rows. Rows 8, 12, 17 and 21 are the ones a naive implementation gets wrong — especially 17: an 86 must not erase a price override, because price and availability resolve independently.**

On top of that, chains need **menu governance**: effective-dated prices (a price change scheduled for Monday 00:00), a draft → approve → publish workflow, and staged rollout to an outlet group. A cashier never changes a price; HQ does. All of it audited.

### Tax and invoice numbering — get this wrong and it is a legal problem
- One **GSTIN per state** per legal entity. Intra-state → CGST + SGST. Inter-state → IGST (matters for central-kitchen transfers across state lines).
- **Invoice numbers must be unique and sequential per GSTIN per financial year (Apr–Mar).** So the numbering series belongs to `(gstin, outlet, series, financial_year)` — never a global counter. Offline terminals draw **reserved blocks** from their outlet's series.
- Stock transfers between outlets under different GSTINs are taxable supplies (delivery challan, e-way bill thresholds). Model the entity now; build in v2.

### Central kitchen / commissary — in scope, Phase 8
Locations (outlet / central kitchen / warehouse), indent → transfer order → dispatch → receive-with-variance, semi-finished goods (a gravy base has its own recipe and its own cost), per-location costing because vendor prices differ by city.

### What multi-outlet does to the free tier
Do the arithmetic in Phase 0. 20 outlets × 300 orders/day × ~4 lines = ~24k order lines/day, ~9M rows/year, before KOT and status events. Supabase free will not hold that. **Decide the partitioning and retention policy in an ADR at Phase 0, not at Phase 10:** partition `orders`/`bills`/`order_status_events` by month, keep a hot window in Postgres, archive the rest. Realtime channels are scoped per outlet, not global.

### The upside: cross-outlet AI is the actual moat
Add as **AI feature H — Network Benchmarking**. Same dish, same brand, different outlet: volume, margin, ticket time, review sentiment. *"Butter chicken at Vastrapur has a 22% lower attach rate than network median and its reviews mention it arriving cold — KDS ticket time there is 8 minutes above the network average."* PetPooja gives you 80 reports and leaves you to find that yourself. This is the feature that justifies RestroBooth existing.

### ⚠️ Honest pushback — read this before Phase 0
Modelling for chains from day one is correct. **Building every chain feature before you have one working outlet is not.** Central kitchen, franchise royalty, staged menu rollout, and cluster dashboards are all Phase 8+. The rule:

> **Model the irreversible things now. Sequence the features so a single real restaurant can pilot RestroBooth by the end of Phase 5.**

Irreversible (Phase 0, non-negotiable): tenancy hierarchy, outlet-vs-store split, membership/RLS model, override matrix, GSTIN-scoped numbering series, data retention. Everything else can wait, and should.

---

## 4. Stack

> **⚠️ Amended 2026-07-13.** The original text said *"free tier throughout."* **It is not achievable, and the deadline is earlier than this brief assumed.**
>
> **The free tier is a development environment, not a deployment target.** Verified against live docs:
> - **Vercel Hobby is non-commercial-personal-use only**, and Vercel's own fair-use definition of commercial usage includes *"any method of requesting or processing payment from visitors of the site"* — and extends to *"financial gain of **anyone** involved in **any part of the production**, including a paid employee or consultant writing the code."* **The Booth's pay-at-table is exactly that. The trigger is Phase 5, not "first paying restaurant."**
> - **Supabase Free: 500 MB DB** (our own arithmetic says 20 outlets = ~48M rows/year — exceeded by *one busy outlet* inside a year), 200 concurrent Realtime connections, and **projects pause after 1 week of inactivity.**
>
> **Real production cost: ~$45/month** (Supabase Pro $25 + Vercel Pro $20/seat). That is a rounding error. **The risk was never the cost — it was discovering the constraint mid-pilot.**
>
> **Binding rule, so this stays cheap:** *no Supabase-specific or Vercel-specific API may be called from `packages/domain` or from any UI component.* Both are reachable only through `packages/db` and a realtime adapter. See [docs/adr/0001-hosting.md](docs/adr/0001-hosting.md).

Free tier for development. Where a free tier has a trap, it is called out.

**Frontend & app**
- Next.js (App Router) + TypeScript, strict mode, React Server Components where they help
- **Turborepo monorepo** — `apps/console`, `apps/pos`, `apps/kds`, `apps/booth` (guest QR), `apps/captain`; `packages/ui`, `packages/domain` (pure billing/tax/KOT logic, zero deps, 100% unit tested), `packages/db`, `packages/ai`, `packages/channels`
- Tailwind v4 + a **custom token layer**. shadcn/ui only as unstyled primitives — every component gets re-skinned to the RestroBooth system. If a screen looks like default shadcn, it has failed.
- **Motion** (framer-motion) for the guest surface and floor map. Near-zero animation on POS/KDS — speed is the aesthetic there.
- TanStack Query + Zustand. Zod at every boundary.
- PWA + Dexie (IndexedDB) for the offline layer.

**Backend & data**
- **Supabase**: Postgres, Auth, Realtime (KDS + floor map + guest order status), Storage (menu images), Edge Functions, **pgvector**, and Row Level Security.
- **Drizzle ORM** (edge-friendly, migration-first). Schema in `packages/db`.
- Next.js Route Handlers / Server Actions for the API; Edge Functions for webhooks that must respond in <1s.

**AI**
- `packages/ai` exposes a **provider interface** — do not hard-code a vendor. Anthropic Claude (Haiku for high-volume guest calls, Sonnet for analysis) as primary; keep a dev-time free provider swappable.
- Embeddings: `gte-small` via Supabase Edge Function → `pgvector`. Free, no external key.
- **Every AI feature must degrade gracefully.** If the model is down, slow, or over budget, the product still works — the AI rail just doesn't render. Per-outlet token budget + response caching keyed on a content hash.

**Payments (India)**
- Razorpay or Cashfree **test mode** for card/UPI/netbanking + webhooks.
- **UPI intent deep-link + static QR** as a zero-cost fallback for pay-at-table.
- Cash, split-tender, and "pay at counter" must all be first-class.

**Printing**
- ESC/POS thermal via a tiny local **print bridge** (Node service on the counter machine, exposed over LAN) — do not rely on browser printing for KOTs. Browser print for A4 invoices only.

**Infra**
- Vercel (hosting), GitHub + Actions (CI), Sentry (errors), PostHog (product analytics). Vitest + Playwright.

**✅ Free-tier traps — VERIFIED 2026-07-13 against live docs. Recorded in [docs/adr/0001-hosting.md](docs/adr/0001-hosting.md).**

| | Free | Pro |
|---|---|---|
| **Vercel** | Hobby: **non-commercial only.** 100 GB transfer, 1M invocations, 4 CPU-hrs. | **$20/user/mo.** Required from **Phase 5** (pay-at-table = commercial use). |
| **Supabase** | **500 MB DB**, 5 GB egress, **200 concurrent Realtime**, 2M messages, **pauses after 1 week idle**. | **$25/mo.** 8 GB, 250 GB egress, 500 concurrent, no pausing. |

**The connection cap is driven by *guests*, not the KDS.** Staff sockets are bounded by headcount; guest sockets are bounded by nothing. Hence: **the Booth polls and does not hold a socket** ([docs/adr/0005-realtime-transport.md](docs/adr/0005-realtime-transport.md)).

---

## 5. The AI layer — concrete, not hand-wavy

**Governing principle: deterministic math first, LLM for language and judgment.** Anything countable (co-occurrence, margin, forecast baseline) is computed in SQL. The LLM explains, ranks, and writes. This keeps it fast, cheap, testable, and honest.

### A. The Booth Host — guest preference concierge *(the headline feature)*
On QR scan, before the menu: a 3-tap intake — **Skip is always visible and always one tap.**
- Party size → mood/occasion → spice tolerance → veg/non-veg/Jain/egg → budget band → allergies (optional).
- Output: the menu **reorders**, a "Picked for you" rail appears with **a reason string per dish** ("mild, shareable, 12 min — most-loved by first-timers"), and off-limits items (allergen/diet) are visually suppressed, not hidden.
- Implementation: rules + vector similarity over item embeddings (built from description + tags + review aspects) → shortlist. LLM only writes the reason copy and handles the free-text case ("something light, I had a heavy lunch"). Cache by preference-vector hash.
- **Never blocks menu render.** Menu paints instantly; the AI rail slides in when ready.

### B. Review → Action pipeline
Post-meal QR feedback + pasted aggregator reviews → structured extraction (aspect: taste / portion / temperature / wait / price / service; sentiment; dish reference) into a typed table. Produces: per-dish sentiment trend, rising complaints, and "3 things to fix this week."

### C. Menu Engineering
Classic BCG matrix (Stars / Plowhorses / Puzzles / Dogs) from sales volume × contribution margin, **cross-referenced with review sentiment** — that cross-reference is the differentiator. Output: reprice / re-plate / promote / retire, each with the numbers behind it.

### D. Prep-list forecasting
Statistical baseline (moving average + day-of-week + festival/holiday calendar + weather) → suggested prep quantity per item, waste estimate. LLM writes the morning brief. **Do not fake ML** — ship the honest baseline and label its confidence.

### E. Smart upsell
Market-basket lift computed in SQL → "goes well with" at cart and on the captain app. LLM writes the one-liner. Measured: attach rate, AOV delta.

### F. Ask RestroBooth (NL analytics)
"Why was last Tuesday down?" → text-to-SQL over a **read-only, allowlisted view layer** (never raw tables), returns a chart + a narrative. Hard guardrails: statement timeout, row cap, no DDL/DML, outlet scoping injected server-side.

### G. Menu Content Studio
Item name + photo → description, allergen tags, Hindi/Gujarati translation, alt text. Human approves before publish.

---

## 6. Channel integrations — the honest picture

**Neither Swiggy nor Zomato has open, self-serve APIs.** Zomato runs a POS partner developer platform (REST APIs for menu management, order management, outlet/timing config, with a sandbox) that requires an approved partner integration request. Swiggy is similarly partner-gated. Middleware (UrbanPiper and similar) exists precisely because of this. **You cannot get keys on day one, and the plan must not depend on them.**

**Therefore, build the abstraction and the simulator first:**

```ts
// packages/channels
interface ChannelAdapter {
  pushMenu(outletId, menu): Promise<SyncResult>
  setItemAvailability(outletId, itemId, inStock): Promise<void>
  onOrderReceived(webhook): Promise<NormalizedOrder>   // idempotent
  acceptOrder(externalId, prepMinutes): Promise<void>
  rejectOrder(externalId, reason): Promise<void>
  markFoodReady(externalId): Promise<void>
  reconcilePayout(period): Promise<PayoutLine[]>
}
```

Implementations, in build order:
1. **`MockAggregator`** — a small standalone app that looks like a Swiggy/Zomato partner dashboard, fires signed webhooks at RestroBooth, and lets you test rider assignment, order rejection, item-out-of-stock, and payout mismatch. **This is the single highest-leverage thing in the integration phase.** Build it properly; you will use it for the rest of the project.
2. **`DirectAdapter`** — RestroBooth's own storefront (your own online ordering, zero commission). Ships first because it needs no one's permission.
3. **`ONDCAdapter`** — ONDC (Beckn protocol, retail F&B domain `RET11`) is genuinely open: public developer docs, a staging/pre-prod registry, reference seller-app frameworks, and a sandbox. It is fiddly (Ed25519 signing, registry subscription, callback endpoints) but it is the only real aggregator you can integrate *today* without a partnership. Treat it as the proof that the adapter layer works against a real network.
4. **`ZomatoAdapter` / `SwiggyAdapter`** — build to the documented contract, ship behind a feature flag, submit the partner request in parallel. Also support **manual reconciliation** (CSV payout upload + mismatch report) so the value exists before the keys do.

---

## 7. Design direction

Read the `frontend-design` skill before designing anything. Then:

**Do the two-pass process.** Brainstorm **three** distinct directions with a token system each (4–6 named hex values, display + body + data typeface, layout concept in ASCII, and one *signature element*). Critique them against the brief. Present all three to me with your recommendation **before writing a line of CSS.**

**Hard constraints:**
- **One design system, three densities.** *Booth* (guest) is generous, cinematic, motion-rich. *POS/KDS* is dense, high-contrast, keyboard-first, and animation-free — a 200ms transition on a billing screen is a bug. *Console* is editorial and calm.
- **Explicitly banned** (these are the current AI-design defaults and they read as a tell): cream `#F4F1EA` + high-contrast serif + terracotta `#D97757`; near-black + single acid-green accent; the hairline-rule broadsheet layout. Also banned: purple→blue gradient hero, glassmorphism cards, floating 3D blobs, "Trusted by 10,000+" bar, generic `01 / 02 / 03` numbered sections.
- **Spend the boldness in one place.** One signature element, everything else disciplined.
- Quality floor, unannounced: responsive to mobile, visible keyboard focus, `prefers-reduced-motion` respected, WCAG AA contrast, 44px touch targets on POS.

**The "booth" is a starting point, not a mandate.** If you find something truer, argue for it. Directions worth exploring (or beating):
- The physical **diner booth** — vinyl, brass, the check presenter, the ticket rail, the neon OPEN sign as a live status object.
- The **KOT ticket** as the atomic visual unit — the whole system rendered as a rail of tickets, receipt-paper texture, a split-flap/Solari board for live order status on the guest phone.
- The **floor plan as the hero** — an isometric, living map of the restaurant where tables breathe with occupancy and orders animate to the kitchen.

Copy is design material. No filler, sentence case, active voice, errors that say what broke and how to fix it, empty states that invite an action.

---

## 8. Phase plan

Every phase ends with: a **runnable demo**, an updated `PROGRESS.md`, and an **explicit approval gate**. Do not start phase N+1 without my sign-off on phase N.

### Phase 0 — Discovery & Architecture *(no application code)*
**Deliver:** `docs/PRD.md` · `docs/DOMAIN.md` (entities, state machines for order/table/KOT/bill, business-day rules, tax rules with worked examples) · `docs/ERD.md` · `docs/adr/` (hosting, ORM, offline strategy, AI provider, realtime transport) · `docs/RISKS.md` · `docs/DESIGN.md` (three directions + recommendation) · `docs/ROADMAP.md`.
**Gate:** I approve the domain model, the offline conflict rules, and one design direction.

### Phase 1 — Foundation *(now carries the chain model — budget more time)*
Monorepo, Supabase project, full schema + migrations, the **org → brand → store → outlet → terminal** hierarchy, GSTIN registration entities, the `memberships` scope model, and **RLS policies with adversarial tests** (a cluster manager must not read a sibling cluster; a franchisee must not read a sibling franchisee — write the test that *tries* and fails). Roles: org owner, brand manager, cluster manager, outlet manager, cashier, captain, kitchen.

**Seed data must be a chain, not a restaurant:** 1 org, 2 brands, 3 outlets across 2 states (so IGST and dual-GSTIN are exercised from day one), one of which is a cloud kitchen where both brands share a single physical outlet. A realistic 120-item Indian menu with variants, add-ons, tax classes.

CI, design tokens, first 10 UI primitives.
**Demo:** log in as each role at each scope and see the boundary hold. `pnpm seed` produces a believable chain, including the shared-kitchen case.

### Phase 2 — Menu Management *(the override matrix lives or dies here)*
Categories, items, variants, add-on groups with min/max rules, item-level tax class, images, bulk CSV import.

Then the hard part, per §3.1: the **brand → outlet → channel → daypart → promo** resolution chain as sparse overrides with a single resolver function and an exhaustive precedence test table. Effective-dated pricing. Draft → approve → publish, with staged rollout to an outlet group. Item 86'ing scoped to a **store**, propagating in real time to POS, KDS, Booth, and every channel listing.
**Demo:** change a price at brand level, watch it land on two outlets but not the third (which has an override); schedule a price change for tomorrow; 86 an item and watch it grey out on the Booth in real time.

### Phase 3a — Ordering, Tables, KOT
Floor/area/table model, table sessions, order capture (POS + captain), KOT generation and routing (different printers per kitchen section — hot/cold/bar), KOT reprint, item void with reason + manager auth, table merge / split / move, live floor map over Realtime.
**Demo:** seat a table, take an order from the captain app, watch the KOT print and the floor map update.

### Phase 3b — Billing, Payments, Day Close *(the crown jewels — go slow here)*
Bill generation, GST/CGST/SGST, discounts, coupons, service charge, packaging, round-off, **split bill (item/amount/guest)**, split tender, void/refund with audit, cash drawer, Day Open/Close reconciliation, GST-compliant invoice print, **offline-first mode with outbox sync**.
**Demo:** kill the network mid-service, bill four tables, reconnect, everything reconciles with zero duplicate bills. `packages/domain` has 100% coverage on money math.

### Phase 4 — KDS
Ticket rail, aging colour states, section filtering, bump / recall, prep-time tracking, ticket-time anomaly flag. Realtime, resilient to socket drops.
**Demo:** readable across the room; survives a 30-second disconnect without losing a ticket.

### Phase 5 — The Booth (QR guest ordering)
Signed per-table QR tokens (rotating, replay-proof), anonymous guest session, the menu experience, cart, add-to-table-order, call-waiter, live order status, pay-at-table (UPI + gateway), post-meal feedback capture.
**Demo:** scan → order → the KOT prints in the kitchen → pay → feedback lands in the DB. End to end on a real phone.

### Phase 6 — AI Layer v1
The Booth Host (§5A), smart upsell (§5E), and the review→action pipeline (§5B). Provider abstraction, budget guard, cache, graceful degradation, and an eval harness — a fixed set of guest-preference scenarios with expected-quality assertions, so recommendation quality is measurable and not vibes.
**Demo:** two guests with different stated preferences get visibly, defensibly different menus. Turn the AI provider off; the app still works.

### Phase 7 — Channels
`ChannelAdapter` interface, the **MockAggregator simulator**, DirectAdapter (own storefront), menu push, stock sync, order ingestion with idempotency, order-state round-trip, payout reconciliation with mismatch report. ONDC staging integration.
**Demo:** an order fired from the simulator lands on the POS and KDS as a delivery order, gets accepted, and reconciles in the payout report.

### Phase 8 — Inventory, Recipes, Purchasing, Central Kitchen

> **Status, 2026-07-23:** this phase was previously hard-gated on a real restaurant running a real service (added 2026-07-13, R1's mitigation for the "chain features are the fun ones" risk). With no pilot restaurant available, the owner made a deliberate, informed call to build ahead of the pilot instead — see [DECISIONS.md](DECISIONS.md). The underlying risk (R1) is still real and still worth naming: central kitchen, franchise royalty, and inter-GSTIN transfers are genuinely interesting engineering, and billing a table correctly with the WiFi down is not, but is still the entire product. Building ahead of the pilot doesn't excuse skipping the unglamorous case coverage — it just means both get built without a real restaurant's feedback yet.

Stock items, units + conversions, recipes/BOM, semi-finished goods, auto-deduction on bill settle, wastage entry, physical stock take with variance, low-stock alerts, vendors, purchase orders, per-location costing, food-cost %.
Then the chain layer: **central kitchen** — indent → transfer order → dispatch → receive-with-variance, inter-outlet transfers, and inter-GSTIN transfers flagged as taxable supplies. Franchise royalty on net sales.
**Demo:** sell a biryani at Outlet 2; the gravy base deducts from the central kitchen's dispatched stock, the rice and packaging deduct locally, and the food-cost % differs between outlets — **partly because vendor prices differ, and partly because the inter-state transfer carried 5% IGST that a no-ITC restaurant cannot reclaim.** Telling an owner *that* is the feature ([docs/DOMAIN.md](docs/DOMAIN.md) §7.5).

### Phase 9 — Reports & AI Layer v2
The report suite (day-end, item-wise, category-wise, hourly heatmap, staff performance, discount audit, tax summary per GSTIN, channel P&L) — each with an **outlet / cluster / brand / org roll-up**, since every report in a chain is really four reports.
Then menu engineering (§5C), forecasting (§5D), Ask RestroBooth (§5F), Content Studio (§5G), and **Network Benchmarking (§3.1, feature H)** — the outlet-vs-network comparison that is the whole reason this beats PetPooja.
**Demo:** ask "which dishes should I take off the menu, and is it every outlet or just some" and get an answer with the numbers, the ticket times, and the review quotes behind it.

### Phase 10 — Hardening & Launch
Perf budget (POS interaction <100ms, Booth LCP <2s on 4G), load test, a11y audit, security review (RLS fuzzing, token replay, webhook signature verification, PII handling), backup/restore drill, onboarding flow, demo tenant, docs.

---

## 9. Standing rules for you, Claude Code

1. **Plan before code.** Every phase starts with a written plan I approve. Every non-obvious choice gets an ADR.
2. **`packages/domain` is sacred.** Pure functions, no I/O, no framework, exhaustive tests. All billing, tax, KOT, and session logic lives there. If a bug in money math can reach production, the architecture is wrong.
3. **Never invent an API contract.** If you don't have real docs for Zomato/Swiggy/a payment gateway, say so, code against the interface, and build the mock. Do not hallucinate endpoints.
4. **Write the migration.** Never mutate schema by hand or guess at columns.
5. **Small, reviewable increments.** One concern per commit. Feature-flag anything half-built.
6. **Test what breaks:** money, idempotency, RLS, offline sync, timezone/business-date. Skip tests for CRUD glue.
7. **Ask before adding a heavy dependency**, and say what it replaces.
8. **Maintain `PROGRESS.md` and `DECISIONS.md`** at the end of every session so the next session starts warm.
9. **Screenshot your UI and critique it** before showing me. If it looks like a template, it is a template.
10. **Flag it when I'm wrong.** If a requirement in this brief is a bad idea, say so with the reason. I'd rather argue at Phase 0 than at Phase 8.

---

## 10. Open decisions — ✅ RESOLVED in Phase 0

> **All eight are answered, with reasoning, in [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md) Part 2.** Summary below. Two are **provisional pending a benchmark that Phase 1 runs as its first task** ([docs/BENCHMARKS.md](docs/BENCHMARKS.md)) — a provisional ADR still provisional at the end of Phase 1 is a process failure, not a pending task.
>
> | # | Decision | Status |
> |---|---|---|
> | 1 | **Store/outlet split survives** all three cases. New rule: *an Outlet is the smallest unit with its own inventory pool AND its own kitchen.* Food-court-with-landlord is an accepted, documented gap. | ✅ |
> | 2 | **Live override resolution.** A materialised view makes effective-dated pricing depend on a cron job — if it's down at midnight Monday, every outlet sells at the wrong price. Escalation ladder if too slow: index → app cache → materialise, in that order. | ⚠️ **PROVISIONAL — BENCH-02** |
> | 3 | **Offline conflict rules are per entity.** No global rule works: `order_items` must *merge* (LWW loses a guest's food); `table_session` close must *reject* (LWW **is** the "table occupied after the guests left" bug). | ✅ |
> | 4 | **Reserved contiguous number blocks**, overlap made impossible by an `exclude using gist` constraint. Offline exhaustion → a dedicated per-terminal *series* (legal: Rule 46(b) permits multiple series). **Gaps are permanent, explained, never reused. A printed invoice number is never renumbered on sync.** | ✅ |
> | 5 | **RLS holds iff the function is `STABLE` and the call is wrapped in `(select …)`** — that's what makes Postgres hoist it to a once-per-statement InitPlan instead of calling it 9M times. JWT-cached outlet IDs are the **last** resort, not the first: revoking a membership does not revoke an outstanding token. | ⚠️ **PROVISIONAL — BENCH-01** |
> | 6 | **Monthly partitions on `business_date`; rollups materialised at Day Close.** Day close is a natural, exact aggregation boundary — so every report older than the hot window reads rollups and never touches a cold partition. Archival costs nothing analytically. | ✅ |
> | 7 | **Captain = PWA.** The decisive argument isn't installability — it's that a native shell means a *second offline implementation of the most dangerous subsystem in the product.* | ✅ |
> | 8 | **Realtime is not enough — and the binding reason isn't socket drops, it's the connection cap, driven by *guests*.** So: monotonic `event_seq` + HTTP backfill on gap, heartbeat + polling fallback, and **the Booth polls rather than holding a socket.** | ✅ |

**Settled:** multi-outlet, multi-brand, shared multi-tenant with RLS. Do not reopen it; design to it.

*Original text, for the record:*
1. **Store vs outlet:** confirm the split in §3.1 survives contact with the cloud-kitchen case, the food-court case, and the same-brand-two-floors case. If it doesn't, tell me now.
2. **Override resolution:** materialised view refreshed on publish, or resolved live on every read? (Live is correct until it isn't. Benchmark it against 20 outlets × 200 items × 6 channels before deciding.)
3. **Offline conflict rule:** last-write-wins, or server-rejects-with-replay? Define per entity — the answer for `order_items` is not the answer for `table_session`.
4. **Offline bill numbering:** reserved server-issued blocks per terminal per GSTIN series. Design the exhaustion and the gap-reporting case (auditors ask about gaps).
5. **RLS performance:** does the `SECURITY DEFINER` membership lookup hold up at 20 outlets and 9M rows, or do accessible-outlet IDs need to be cached in the JWT? Benchmark, don't guess.
6. **Data retention:** what's the hot window in Postgres, and where does the cold data go? Cost it.
7. Captain app: PWA or native shell? (Recommend PWA — argue it.)
8. Is Realtime enough for the KDS, or does it need a heartbeat + polling fallback? (It needs the fallback. Prove me right or wrong.)

---

## ▶︎ PHASE 0 KICKOFF — paste this into Claude Code

```
Read RESTROBOOTH_BRIEF.md in full, then read the frontend-design skill.

We are at Phase 0. Write NO application code.

Scope is settled: multi-outlet, multi-brand chains from day one (see §3.1).
Model everything irreversible now; sequence features so a single outlet can
pilot by Phase 5.

Produce, in /docs:
1. PRD.md — scope, personas, surfaces, v1 vs later, success criteria.
2. TENANCY.md — the org/brand/store/outlet/terminal model, the GSTIN entity,
   the memberships + RLS scope model with adversarial test cases, and the full
   menu override precedence matrix with an exhaustive worked example table
   (brand → outlet → channel → daypart → promo). Stress-test the store-vs-outlet
   split against: a cloud kitchen running 4 brands, a food court stall, and one
   brand on two floors of one building.
3. DOMAIN.md — entities and state machines for order, table session, KOT, bill.
   Worked numeric examples for: a bill with two tax classes; an item-level
   discount; service charge; round-off; a split-by-guest bill; and an
   inter-state (IGST) central-kitchen transfer. Define the business-day rule,
   the GSTIN-scoped invoice numbering series, and the offline conflict rules
   per entity.
4. ERD.md — full schema with types, constraints, partitioning plan, RLS policies.
5. adr/ — one ADR each for: hosting + free-tier limits (verify against LIVE docs,
   do not trust memory — and do the row-volume arithmetic for 20 outlets),
   data retention/archival, ORM, offline sync, realtime transport, override
   resolution (live vs materialised), AI provider abstraction.
6. RISKS.md — top 10 risks ranked, each with a mitigation. Be blunt about the
   Swiggy/Zomato partner-gating risk and about scope creep from the chain model.
7. DESIGN.md — three distinct directions per the frontend-design skill. Each:
   4–6 named hex tokens, display/body/data typefaces, an ASCII layout sketch,
   one signature element. Critique each against the banned-defaults list, then
   recommend one and defend it. Show how the direction survives at all three
   densities (Booth / POS+KDS / Console).
8. ROADMAP.md — phases with acceptance criteria and demo scripts, and an explicit
   "single-outlet pilot path" cutting through them.

Then stop and give me: your top three disagreements with this brief, and each
open decision in §10 with your recommendation and reasoning.
```
