# RestroBooth — Tenancy, Access, and the Menu Override Matrix

**Status: ✅ APPROVED — 2026-07-13.** The tenancy model, the `store`-keyed override chain, the outlet-boundary rule (§2 Case C), and the RLS scope model are settled. **Phase 1 builds to this.**
**Last updated:** 2026-07-13

Everything in this document is irreversible. It is the schema that a rewrite would be needed to change. Read §4 and §7 closely; those are the two places where I am refining the brief rather than executing it.

---

## 1. The hierarchy

```
Organization ────────────── legal entity (franchisor or franchisee)
  ├── GstRegistration ───── one GSTIN per STATE per legal entity
  ├── Brand ─────────────── the menu owner, the thing a guest recognises
  │     └── MenuItem ────── defined ONCE, at brand level
  └── Outlet ────────────── a physical place (kitchen, inventory pool, printers, staff, tables)
        ├── Store ───────── a Brand selling at an Outlet  ← the sellable unit
        │     └── channel listings, menus, orders
        └── Terminal ───── a POS device (drawer, printer set, invoice number blocks)
```

`Store` is the join of `Brand` and `Outlet`, promoted to a first-class entity because things hang off it.

**Outlet is a place. Store is a brand selling at a place.** The distinction is the single most valuable line in the brief, and it holds. Restating it as a rule you can apply mechanically:

> **Attach to `outlet` anything that is physical or shared: inventory, staff, tables, printers, KDS, cash drawers, the GSTIN it bills under.**
> **Attach to `store` anything a guest could perceive as belonging to a brand: menus, prices, availability, channel listings, orders, bills, reviews.**

---

## 2. Stress test: does the split survive?

The brief demands three cases. It survives all three, but the third one forces a rule we did not previously have.

### Case A — Cloud kitchen, 4 brands, one 400 sq ft kitchen

| Entity | Count | Notes |
|---|---|---|
| Outlet | 1 | One kitchen, one inventory pool, one KDS, one staff roster, one GSTIN |
| Store | 4 | Four brands, four menus, four Swiggy listings, four sets of orders |
| Brand | 4 | Each with its own menu items |

**Verdict: this is precisely what the split exists for.** A single `outlet_id` on a menu item would be unmodellable here. The KDS is outlet-scoped and shows tickets from all four stores, tagged by brand — which is what a real cloud kitchen expeditor needs. Inventory deducts from one pool across four brands' recipes, which is the whole economic point of a cloud kitchen. ✅

### Case B — A food-court stall

| Entity | Count | Notes |
|---|---|---|
| Outlet | 1 | The stall. Its own till, its own tiny kitchen. |
| Store | 1 | One brand at one place. |

**Verdict: fits trivially, but exposes a genuine gap — and I am declaring it out of scope on purpose.** The food court's *shared* infrastructure (common seating, a mall-operated central cashier, a mall-issued token/queue system, revenue-share on gross sales to the mall operator) has no home in this model. There is no `Landlord` or `Venue` entity.

That is the right call for now: adding a venue entity to serve a case we are not piloting is exactly the chain-model scope creep the brief warns about. But be clear-eyed about what it costs: **a food court where the mall runs the cashier is not a RestroBooth customer in v1**, because we assume the outlet owns its own billing and its own tables. A stall that bills its own guests works fine today. Revisit if a food-court operator is ever a real prospect; it is an additive entity, not a rewrite. ⚠️ *Accepted gap.*

### Case C — One brand, two floors of one building

This is the ambiguous one, and the brief does not give a rule. Both readings are defensible on the surface, and picking wrong is expensive in either direction: model it as two outlets when it is really one, and your inventory splits into two pools that constantly need transfers for no reason. Model it as one outlet when it is really two, and you cannot route KOTs to the right kitchen or reconcile two cash drawers.

**The rule I propose — the outlet boundary is the operational boundary:**

> **An Outlet is the smallest unit that has its own inventory pool AND its own kitchen (KOT printer set). If two areas share both, they are one outlet with two areas. If they have their own of either, they are two outlets.**

Applied:

| Real-world situation | Model | Why |
|---|---|---|
| Ground floor café, first floor dining, **one kitchen, one store-room** | **1 outlet, 2 areas** | KOTs go to the same kitchen. Stock is one pool. Two cash drawers is fine — a drawer belongs to a *terminal*, not an outlet. |
| Ground floor restaurant, rooftop bar with **its own bar-kitchen and its own liquor stock** | **2 outlets** | Separate KOT routing, separate inventory, separate (likely) licences. They may share a GSTIN and a brand — that is allowed and expected. |
| Same, but the rooftop is a **different brand** | **2 outlets, 2 stores, 2 brands** | Falls out of the model for free. |

Two consequences worth stating explicitly, because they are easy to get wrong:

- **A cash drawer belongs to a Terminal, not an Outlet.** Two floors, one kitchen, two tills = one outlet, two terminals, two drawers, two invoice-number blocks, one day-close that reconciles both. The day-close ritual therefore aggregates *per terminal* and rolls up *per outlet*.
- **Areas are a floor-plan concept, not a tenancy concept.** `area` is a child of `outlet` used for table grouping and floor-map layout (`Ground`, `Rooftop`, `Garden`, `Bar`). It carries no access control and no inventory. It *may* carry a default KOT print route, which is how a one-outlet-two-floors venue gets drinks printing at the bar station.

**Verdict: the split survives all three cases.** ✅ Case B is an accepted, documented gap.

---

## 3. GST registration

```
Organization 1 ─── n GstRegistration (one per state)
Outlet         n ─── 1 GstRegistration  (the outlet bills under exactly one GSTIN)
```

- One **GSTIN per state per legal entity**. An org with outlets in Gujarat and Maharashtra has two GSTINs.
- The GSTIN is a property of the **outlet** (a place is in a state), not the store or the brand. A cloud kitchen with four brands issues all four brands' invoices under one GSTIN.
- Intra-state supply → **CGST + SGST**. Inter-state → **IGST**.
- Two outlets of the same org under **different GSTINs are "distinct persons"** under GST §25(4). A stock transfer between them **is a taxable supply** and needs a tax invoice, not just a delivery challan. Two outlets under the *same* GSTIN transferring stock is *not* a supply — delivery challan only, no tax. This is why the GSTIN entity must exist in Phase 1 even though central kitchen is Phase 8. Worked example in [DOMAIN.md](DOMAIN.md) §7.5.

**Invoice numbering is scoped to the GSTIN**, not the org and not the outlet. See [DOMAIN.md](DOMAIN.md) §6 — including the 16-character legal limit on invoice numbers, which constrains the format more than people expect.

---

## 4. The access model

```sql
memberships (
  user_id     uuid,
  scope_type  enum('org','brand','outlet_group','outlet'),
  scope_id    uuid,
  role        enum('org_owner','brand_manager','cluster_manager',
                   'outlet_manager','cashier','captain','kitchen'),
  ...
)
```

A user has **many memberships**. This is the entire reason a single `outlet_id` column on the user table is wrong: a cluster manager owns an arbitrary *subset* of outlets, and that subset is not a prefix of the hierarchy.

`outlet_group` is a named, arbitrary bag of outlets (`"Ahmedabad West"`, `"Airport locations"`, `"Pilot cohort"`). An outlet may belong to several groups. Groups are for access and for reporting roll-ups, and they are *not* part of the ownership tree — which is what makes them able to express a cluster.

**Resolution.** Every membership resolves down to a set of accessible outlets:

| scope_type | resolves to |
|---|---|
| `org` | every outlet in the org |
| `brand` | every outlet that has a store for that brand |
| `outlet_group` | every outlet in the group |
| `outlet` | that one outlet |

Roles are **capabilities within a scope**, not levels. A user can be `cluster_manager` over `outlet_group:west` and simultaneously `cashier` at `outlet:andheri` — and at Andheri they can open a drawer, which the cluster role does not grant. **Capabilities are the union across memberships; the outlet set is the union across memberships.** Never take the max of a role rank; there is no rank.

### Capability matrix

| Capability | org_owner | brand_manager | cluster_manager | outlet_manager | cashier | captain | kitchen |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Read reports (in scope) | ✅ | ✅ | ✅ | ✅ | own shift | — | — |
| Edit menu / price (propose) | ✅ | ✅ | — | — | — | — | — |
| **Approve + publish price** | ✅ | ✅ | — | — | — | — | — |
| Override price on a bill | ✅ | — | ✅ | ✅ | — | — | — |
| Apply discount ≤ threshold | ✅ | — | ✅ | ✅ | ✅ | — | — |
| Apply discount > threshold | ✅ | — | ✅ | ✅ | — | — | — |
| Void a fired KOT item | ✅ | — | ✅ | ✅ | — | — | — |
| Void / refund a settled bill | ✅ | — | ✅ | ✅ | — | — | — |
| Take an order | ✅ | — | ✅ | ✅ | ✅ | ✅ | — |
| Settle a bill | ✅ | — | ✅ | ✅ | ✅ | — | — |
| Day open / day close | ✅ | — | ✅ | ✅ | — | — | — |
| Bump a KOT | ✅ | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| 86 an item | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ |

The single most important row: **a cashier cannot change a price, and cannot void a fired item.** Those two rules are where POS fraud lives.

### RLS mechanism

```sql
create function accessible_outlet_ids(uid uuid)
returns setof uuid
language sql
stable                    -- NOT volatile: lets the planner hoist it
security definer          -- reads memberships, bypassing memberships' own RLS
set search_path = public
as $$ ... $$;
```

Policy shape on every outlet-scoped table:

```sql
create policy outlet_isolation on orders
  for all
  using ( outlet_id in (select accessible_outlet_ids((select auth.uid()))) );
```

**Two non-obvious implementation rules that are the whole ballgame for performance:**

1. The function is `STABLE`, and the call is wrapped in `(select ...)`. This makes Postgres evaluate it **once per statement as an InitPlan** rather than **once per row**. Without the wrapper, this policy is evaluated 9 million times on a full scan. This is the difference between 40 ms and a timeout, and it is the single most common way Supabase RLS deployments fall over.
2. `(select auth.uid())` is likewise wrapped, for the same reason.

**CONFIRMED (2026-07-14).** BENCH-01 ran at 20 outlets / 9M rows and the hoisted version holds — full numbers, `EXPLAIN` plans, and methodology in [BENCHMARKS-RESULTS.md](BENCHMARKS-RESULTS.md). It confirms the InitPlan hoist directly (every access-function `SubPlan` shows `loops=1`, not once per row) and finds variant B (real policies) within ~1.5-1.8x of variant A (RLS bypassed) on the two query shapes compared — well inside BENCHMARKS.md's "~2x of the floor" bar. The JWT-caching fallback specified there was **not needed**. Two of the seven query shapes (Q3, Q4) failed badly on the first run — up to 43x over threshold — but the cause was two missing indexes and a stale-statistics/planner interaction, not this mechanism; see the results doc for the full trace. See [adr/0006-override-resolution.md](adr/0006-override-resolution.md) for the analogous (also now CONFIRMED) decision on the menu side.

---

## 5. Store-vs-outlet: which column goes where

The cheat sheet. When adding a table in any later phase, this is the question to answer first.

| Attaches to **OUTLET** | Attaches to **STORE** | Attaches to **BRAND** |
|---|---|---|
| `gst_registration_id` | channel listings | menu item definitions |
| inventory / stock ledger | menus and menu sections | recipes (default) |
| staff, shifts, attendance | prices and price overrides | item images, descriptions |
| tables, areas, floor plan | item availability (86) | brand identity, logo |
| printers, KOT routes, KDS | **orders** | tax class defaults |
| terminals, cash drawers | **bills** | allergen / diet tags |
| day open / day close | guest reviews | |
| purchase orders, vendors | promos | |

If a new table is ambiguous, ask: *"in a four-brand cloud kitchen, is there one of these or four?"* One → outlet. Four → store.

---

## 6. Adversarial RLS test cases

These are written as assertions now so Phase 1 can transcribe them into tests verbatim. **Every one must FAIL to return data.** A passing RLS suite is one where all of these are denied.

Fixture (this is also the Phase 1 seed): **1 org, 2 brands, 3 outlets across 2 states**, one of which is a shared cloud kitchen.

| # | Actor | Attempt | Expected |
|---|---|---|---|
| A1 | `cashier @ outlet:AMD-1` | `select * from bills where outlet_id = 'AMD-2'` | 0 rows |
| A2 | `cashier @ outlet:AMD-1` | `select * from bills` (no filter) | only AMD-1 rows |
| A3 | `cluster_manager @ group:WEST` (AMD-1, AMD-2) | read `outlet:MUM-1` (group EAST) | 0 rows |
| A4 | `cluster_manager @ group:WEST` | `update outlets set gst_registration_id=… where id='MUM-1'` | 0 rows affected |
| A5 | `outlet_manager @ outlet:AMD-1` | read `memberships` of a user at MUM-1 | 0 rows |
| A6 | `cashier @ outlet:AMD-1` | `update menu_item_overrides set price_paise = 1` | denied (capability, not scope) |
| A7 | `captain @ outlet:AMD-1` | `insert into bills (...)` | denied |
| A8 | `brand_manager @ brand:B1` | read orders of `store(B2 @ AMD-1)` | 0 rows — **same outlet, different brand** |
| A9 | `kitchen @ outlet:AMD-1` | `select * from bills` | 0 rows — kitchen has no financial read |
| A10 | Franchisee org O2 user | read any row of org O1 | 0 rows |
| A11 | Anonymous Booth guest session (table T5 @ AMD-1) | read `orders` for table T6 | 0 rows |
| A12 | Anonymous Booth guest session | read `menu_items` | ✅ **allowed** (published items only, for that store) |
| A13 | Anonymous Booth guest session | read `bills`, `memberships`, `stock_ledger` | 0 rows |
| A14 | Expired/replayed Booth QR token | any read | denied at token layer before RLS |
| A15 | `cashier @ outlet:AMD-1` | `select accessible_outlet_ids('<other-user-uuid>')` | denied / empty — the function must not be a lookup oracle |

**A8 is the one that catches a naive implementation.** In the cloud kitchen, two brands share an outlet. Outlet-scoping alone would let brand B1's manager read brand B2's orders. Orders are **store-scoped**, and the policy for a `brand_manager` must intersect outlet-access with brand-access. This is the test that proves the store entity is real and not decorative.

**A15 is the one people forget.** A `SECURITY DEFINER` function that will happily resolve *any* user's outlets is an information-disclosure hole. It must assert `uid = auth.uid()` internally, or take no argument at all and read `auth.uid()` itself. **Take no argument.** That is the safer signature and it is what we will build.

---

## 7. The menu override matrix

### 7.1 A correction to the brief

The brief §3.1 describes the chain as `brand default → outlet override → channel override → daypart → promo`. **The second link should key on `store_id`, not `outlet_id`.**

Reason: a menu item belongs to a brand. An override row keyed on `outlet_id` can express an illegal state — *"item X (brand B1) is priced ₹250 at outlet AMD-1"* is meaningless if brand B1 doesn't sell at AMD-1, and ambiguous in the cloud kitchen where four brands share the outlet. `store_id` is exactly `(brand, outlet)`, which is the pair that actually determines the price. It is the same thing in the single-brand case and it is the *only* correct thing in the multi-brand case.

Since `store` is the entity the brief itself says orders and menus attach to, this is a consistency fix, not a change of direction. **Everything below uses `store`.**

### 7.2 The precedence chain

```
brand default price                    (always exists — the base)
  → store override        (Andheri charges more than Ahmedabad)
    → channel override    (Zomato price ≠ dine-in price — always)
      → daypart override  (happy hour, breakfast)
        → promo           (active campaign)
```

Stored as **sparse override rows**, never duplicated menus. One row per (item × dimension tuple), only where an override actually exists.

```sql
menu_item_override (
  id              uuid pk,
  menu_item_id    uuid not null,          -- the brand-level item
  store_id        uuid null,              -- dimension S
  channel_code    text null,              -- dimension C  ('dinein','zomato','swiggy','ondc','direct','captain')
  daypart_id      uuid null,              -- dimension D
  promo_id        uuid null,              -- dimension P
  price_paise     bigint null,            -- null = "don't override price, only availability"
  is_available    boolean null,
  effective_from  timestamptz not null,
  effective_to    timestamptz null,
  status          enum('draft','approved','published'),
  ...
)
```

### 7.3 Resolution: binary specificity

Give each dimension a binary weight and sum them:

```
specificity = 8·(promo present) + 4·(daypart present) + 2·(channel present) + 1·(store present)
```

Because each weight exceeds the sum of all lower weights (8 > 4+2+1, 4 > 2+1, 2 > 1), **highest specificity wins** reproduces the brief's precedence chain *exactly and provably*, for every one of the 16 combinations — including the awkward ones like "a promo that is not store-specific vs. a store+channel+daypart override" (the promo wins, weight 8 > 7). This is why the weights are binary rather than 1/2/3/4: it makes precedence a total order with no ties possible between *different* combinations.

Resolution algorithm, in one query:

```
candidates = rows WHERE menu_item_id = :item
  AND status = 'published'
  AND (store_id   IS NULL OR store_id   = :store)
  AND (channel_code IS NULL OR channel_code = :channel)
  AND (daypart_id IS NULL OR daypart_id IN :active_dayparts_at(:t))
  AND (promo_id   IS NULL OR promo_id   IN :active_promos_at(:t, :store))
  AND :t >= effective_from AND (effective_to IS NULL OR :t < effective_to)

winner = candidates ORDER BY specificity DESC, published_at DESC LIMIT 1
price  = COALESCE(winner.price_paise, brand_default_price)
```

Note `price` and `is_available` **resolve independently**. An override row that sets only `is_available = false` (an 86) must not wipe out a price override from a *less* specific row. Resolve each field with its own `ORDER BY specificity DESC` over rows where that field is non-null. This is a real bug waiting to happen and the test table below covers it (rows 17–18).

Ties within the same specificity (two published promos both active, both store+channel scoped) break by `published_at DESC`. **A tie is a menu-governance smell** — the console must warn on overlapping active promos at publish time rather than silently letting recency decide.

### 7.4 The exhaustive precedence table

**This becomes the Phase 2 unit-test fixture verbatim.** Base: item `Butter Chicken`, brand default **₹380.00** (38000 paise). Store = `AMD-1`, channel = `zomato`, daypart = `happy_hour`, promo = `MONSOON20`.

Override rows available in the fixture:

| Row | store | channel | daypart | promo | price | spec |
|---|:-:|:-:|:-:|:-:|---|:-:|
| S | AMD-1 | – | – | – | ₹400 | 1 |
| C | – | zomato | – | – | ₹450 | 2 |
| SC | AMD-1 | zomato | – | – | ₹460 | 3 |
| D | – | – | happy_hour | – | ₹340 | 4 |
| SD | AMD-1 | – | happy_hour | – | ₹350 | 5 |
| CD | – | zomato | happy_hour | – | ₹420 | 6 |
| SCD | AMD-1 | zomato | happy_hour | – | ₹430 | 7 |
| P | – | – | – | MONSOON20 | ₹320 | 8 |
| SP | AMD-1 | – | – | MONSOON20 | ₹330 | 9 |
| CP | – | zomato | – | MONSOON20 | ₹410 | 10 |
| SCP | AMD-1 | zomato | – | MONSOON20 | ₹415 | 11 |
| DP | – | – | happy_hour | MONSOON20 | ₹300 | 12 |
| SDP | AMD-1 | – | happy_hour | MONSOON20 | ₹310 | 13 |
| CDP | – | zomato | happy_hour | MONSOON20 | ₹405 | 14 |
| SCDP | AMD-1 | zomato | happy_hour | MONSOON20 | ₹425 | 15 |

Every combination of *which rows exist*, resolved:

| # | Rows present | Query context (store / channel / daypart / promo) | Expected | Because |
|---|---|---|---|---|
| 1 | none | AMD-1 / dinein / – / – | **₹380** | brand default |
| 2 | S | AMD-1 / dinein / – / – | **₹400** | S (spec 1) |
| 3 | S | AMD-2 / dinein / – / – | **₹380** | S doesn't match store → default |
| 4 | C | AMD-1 / zomato / – / – | **₹450** | C (spec 2) |
| 5 | C | AMD-1 / dinein / – / – | **₹380** | C doesn't match channel → default |
| 6 | S, C | AMD-1 / zomato / – / – | **₹450** | C (2) beats S (1) |
| 7 | S, C, SC | AMD-1 / zomato / – / – | **₹460** | SC (3) beats both |
| 8 | S, C, SC, D | AMD-1 / zomato / happy_hour / – | **₹340** | D (4) beats SC (3) — **daypart outranks store+channel** |
| 9 | SC, SD | AMD-1 / zomato / happy_hour / – | **₹350** | SD (5) beats SC (3) |
| 10 | SD, CD | AMD-1 / zomato / happy_hour / – | **₹420** | CD (6) beats SD (5) |
| 11 | SD, CD, SCD | AMD-1 / zomato / happy_hour / – | **₹430** | SCD (7) — most specific non-promo |
| 12 | SCD, P | AMD-1 / zomato / happy_hour / MONSOON20 | **₹320** | P (8) beats SCD (7) — **promo outranks everything below it** |
| 13 | P, SP | AMD-1 / zomato / happy_hour / MONSOON20 | **₹330** | SP (9) |
| 14 | SP, CP | AMD-1 / zomato / happy_hour / MONSOON20 | **₹410** | CP (10) |
| 15 | CP, SCP, DP | AMD-1 / zomato / happy_hour / MONSOON20 | **₹300** | DP (12) beats SCP (11) |
| 16 | all 15 rows | AMD-1 / zomato / happy_hour / MONSOON20 | **₹425** | SCDP (15) — the maximum |
| 17 | S(₹400), + row `SC` with `is_available=false` and `price=NULL` | AMD-1 / zomato / – / – | **₹400, unavailable** | **fields resolve independently** — the 86 must not erase the price |
| 18 | D(₹340) + row `SD` with `price=NULL, is_available=NULL` | AMD-1 / dinein / happy_hour / – | **₹340** | an all-null override row is inert, not a reset-to-default |
| 19 | all 15, but query at 15:00 (happy_hour is 17:00–19:00) | AMD-1 / zomato / – / MONSOON20 | **₹415** | SCP (11) — daypart rows drop out of `candidates` entirely |
| 20 | S with `effective_from = tomorrow` | AMD-1 / dinein / – / – (today) | **₹380** | effective-dating excludes it; **tomorrow this same query returns ₹400** |
| 21 | two published promos P1(₹320) and P2(₹315), both active, same spec | AMD-1 / dinein / – / – | **₹315** + ⚠️ governance warning at publish | tie → `published_at DESC`; the console should have refused to publish this cleanly |

Rows 8, 12, 17, and 21 are the ones a naive implementation gets wrong. Row 20 is the one that proves effective-dating works.

### 7.5 Menu governance

A cashier never changes a price. HQ does, and it is audited.

```
draft ──propose──> pending_approval ──approve──> approved ──publish──> published
                          │                          │
                          └──reject──> draft         └──schedule──> published @ effective_from
```

- **Effective-dated:** publishing sets `effective_from`, which may be in the future. A price change scheduled for Monday 00:00 is `published` on Friday and simply does not win resolution until Monday. **There is no cron job**, and that is deliberate: the resolver is time-aware, so a scheduled change cannot fail to fire because a worker was down. This is a direct consequence of choosing live resolution ([ADR-0006](adr/0006-override-resolution.md)) and is one of the strongest arguments for it.
- **Staged rollout:** publish to an `outlet_group` → creates store-scoped override rows for each store in the group, in one transaction, with a shared `publish_batch_id` so the whole batch can be rolled back as a unit.
- **Audit:** every state transition writes to `menu_audit_log` (who, when, from → to, old value → new value). Immutable, append-only, never partitioned away.

---

## 8. Realtime channel scoping

Realtime channels are scoped **per outlet**, never global, and the KDS subscribes to `outlet:{id}:kot` while the Booth subscribes to `store:{id}:order:{session}`. A global channel would broadcast one restaurant's tickets to every connected client in the system and would blow the concurrent-connection cap immediately. See [adr/0005-realtime-transport.md](adr/0005-realtime-transport.md).
