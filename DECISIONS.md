# RestroBooth — Decision Log

Append-only. Newest first. One entry per decision that a future session would otherwise re-litigate.

---

## 2026-07-15 — Phase 2 closed out: the two remaining unit tests, one deliberate refinement

**Decided by:** Mohammed ("proceed with the plan for this phase").

Wrote the two tests the Phase 2 plan's §4 listed but that hadn't been written yet, completing every checklist item except "CI green on push" (which needs a push):

- **Money entry** (`packages/ui/src/components/money.test.ts`). To make it testable, `parseRupeesToPaise`/`formatPaiseAsRupees` were extracted from `MoneyInput.tsx` (a `"use client"` component importing CSS) into a plain `money.ts`. Money math has no business living inside a rendering component anyway.
- **Audit log** (`packages/db/test/audit/audit.test.ts`). Verifies a publish writes exactly one correct row (entity/actor/action/old→new) AND that the rows are RLS-isolated across orgs — the latter is the part that actually "breaks" (an audit trail that leaks across tenants is a confidentiality breach). Writes go through the real `withUser()` path the Server Action uses.

**One deliberate refinement of the plan, recorded so it isn't re-litigated:** the plan's §4 described money entry as "rejects fractional paise **and rounds half-up**." The implementation does NOT round — it *rejects* a third decimal place outright (`180.505` → validation error, not `180.51`). Reasoning: the domain-wide half-up rule (DOMAIN.md §5) is for values *computed* from others (tax), where fractional paise are unavoidable. Direct price *entry* is different — a human typing a price should get exactly what they typed or an error, never a number silently adjusted under them. The test pins the reject behaviour; `money.ts`'s header carries the reasoning.

---

## 2026-07-14 — Phase 2 checkpoint: menu catalog + governance capability layer (A6, A9 un-skipped)

**Decided by:** Mohammed, via an approved plan (`/plan`), executed to the checkpoint boundary.

**What shipped:** the menu catalog schema (`categories`, `option_groups`, `option_items`, `menu_audit_log`; `menu_items.category_id`) and the role-capability layer Phase 1 deliberately deferred — un-skipping RLS suite cases **A6** ("cashier cannot change a price, but can still 86 an item") and **A9** ("kitchen role has no financial read"). Full console UI: `/menu` (category → item list), `/menu/new`, `/menu/[id]` (edit item, manage variants/add-ons, publish a store price, 86/un-86, audit trail).

**Scope calls made explicitly during planning** (not assumed): governance is simplified to one `publish` action for privileged roles, fully audited — not the full propose→approve/reject ceremony; catalog scope is categories + variants + add-ons only (images and bulk CSV import deferred); a variant's price is **absolute, not a delta** from the base item (matches how DOMAIN.md already treats add-ons); staged rollout to an outlet group and order-line variant/add-on selection are out of scope (no writer exists yet for either).

**Design: A6 is a trigger, not RLS.** The rule is column-scoped (`price_paise` vs `is_available` on the *same* `menu_item_overrides` row) — plain `USING`/`WITH CHECK` can't express that. `can_set_menu_price(brand_id)` (`SECURITY DEFINER`, mirrors `accessible_*_ids()`'s scope resolution) backs a `BEFORE INSERT OR UPDATE OF price_paise` trigger. **A9 is RESTRICTIVE RLS** — a role predicate ANDed onto `bills`/`bill_tax_lines`/`payments`' existing scope policy, not a new permissive one. BENCH-01 was re-run after the A9 change (a hot-policy edit is exactly the kind of thing this project re-benchmarks rather than assumes safe) — still passes everywhere, `EXPLAIN` confirms the new predicate is still InitPlan-hoisted (`loops=1`).

**Four real bugs found and fixed while building this, not before:**
1. `packages/db`'s CLI entrypoint guard (`import.meta.url === `file://${process.argv[1]}``) never matched on Windows (backslash path vs. properly-encoded `file:///C:/...` URI) — **`pnpm seed` had been silently no-op'ing every direct invocation on this machine.** The test suite never caught it because it imports `seedBelievableChain()` directly, bypassing the guard entirely. Fixed with `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`.
2. The new price-capability trigger fires for **every** insert/update on `menu_item_overrides`, including trusted server-side paths with no JWT claim set (the seed script's superuser connection, the override precedence test suite's fixture helper) — both were silently relying on RLS bypass that the trigger doesn't grant. Fixed by having both act as a real privileged user (`withUser`) for the specific inserts that set a price, which is also more honest: a "published" override implies someone with the right role published it.
3. Drizzle wraps every driver-level failure in `DrizzleQueryError`, whose own `.message` is `"Failed query: <sql>"` — the actual Postgres error (our trigger's `RAISE EXCEPTION` text) lives in `.cause.message`. `item-actions.ts`'s friendly-error substitution (`message.includes("insufficient privilege")`) was checking the wrong field and **would never have fired in the real app** — a cashier would have seen a raw SQL dump instead of "ask an owner or brand manager." Caught by the checkpoint's own end-to-end verification script, not by typecheck or lint.
4. `packages/db` needed an actual build step (`tsconfig.build.json` → `dist/`) to be consumable by Turbopack at all — see the Phase 2 auth-slice entry below; this checkpoint is the first one that exercises it for schema changes, confirming the fix holds.

**Verification approach, and its limit, stated plainly:** Server Actions require Next's request-scoped `cookies()`, so they can't be invoked standalone outside a real HTTP request. Verified instead via `packages/db/scripts/verify-menu-capability.ts` (a manual checkpoint script, not part of the suite) driving the exact same `withUser()` primitive the Server Actions use — full lifecycle: create item → add variant/add-on → owner publishes a price → `resolve_menu()` reflects it immediately → cashier's price attempt rejected → cashier's 86 succeeds → price still shows post-86 (fields resolve independently) → audit trail correct. Combined with a clean `next build` and real HTTP checks of the unauthenticated-redirect path. **What is NOT verified: the actual browser form-submission flow and any visual review** — no browser/screenshot tool exists in this environment, same gap as `/style-guide` in Phase 1.

---

## 2026-07-14 — Phase 1 closed. Both provisional ADRs **CONFIRMED**; RLS/override suites, benchmarks, design tokens, and CI all shipped.

**Decided by:** Mohammed (session directive: "proceed till end of this phase").

The two decisions left PROVISIONAL at the end of Phase 0 are now settled with real numbers, not reasoning:

- **ADR-0006 (live menu override resolution): CONFIRMED.** BENCH-02's gate (R1: full 200-item menu resolve) ran at p95=2.9ms against a 50ms threshold — 17x margin. No escalation needed.
- **RLS via `STABLE` + `(select …)` InitPlan hoist (TENANCY.md §4): CONFIRMED.** BENCH-01 ran the 7-query set as 4 role shapes against the full 9M-row fixture. Full numbers, methodology, and three real bugs the benchmark caught (two missing indexes, one stale-statistics gap, one planner/RLS interaction with inline date arithmetic) are in [docs/BENCHMARKS-RESULTS.md](docs/BENCHMARKS-RESULTS.md) — none of the three were `accessible_outlet_ids()` itself; `EXPLAIN` confirms it evaluates once per statement (`loops=1`) everywhere, exactly as designed.

**A genuine negative result, reported rather than massaged:** the planned three-way RLS off/wrapped/naive-VOLATILE comparison did not reproduce the textbook "naive RLS is catastrophic" case for the two query shapes tested — an uncorrelated `IN (SELECT set_returning_fn())` gets hashed once by the planner regardless of the function's volatility marking. Doesn't weaken the case for the `(select …)` wrapper (which is what makes the *scalar* `auth.uid()` form safe), but the specific comparison as built came back smaller than TENANCY.md's prose implied.

**Also shipped this session:** the 15-case RLS adversarial suite and 21-row override precedence suite (both passing against a real Supabase CLI local stack, real GoTrue-backed `auth.uid()`, not the dev stub); design tokens + all 10 UI primitives for Direction B on `/style-guide`; a `db:check-partitions` assertion; and three CI workflows (per-PR, a scheduled staging check that no-ops until a real staging project exists, and a manual benchmark re-run).

**Known gaps, not silently closed:**
- **No screenshot/visual critique of `/style-guide` happened.** CLAUDE.md rule 11 calls for one; this environment has no browser/screenshot tool, so verification stopped at a clean production build plus HTTP-content assertions across all four density sections. A human still needs to actually look at it.
- **CI has not run for real** — the three workflow files validate as well-formed YAML and every step was exercised locally with equivalent commands (lint/typecheck/build/db:check/db:check-partitions/RLS suite all passed), but nothing has actually executed inside GitHub Actions yet, since that requires pushing to origin and this session did not push (commits only, per standing instruction).
- **A6, A7, A9, A14 of the 15-case RLS suite are `test.skip`, not implemented-and-passing** — role capability (not tenant scope) and QR-token-replay concerns that ROADMAP.md itself scopes to Phase 2/3a/5. Documented in the test file, not hidden.

---

## 2026-07-13 — Domain model **APPROVED**; offline conflict rules **PARKED**

**Decided by:** Mohammed. **Gate items 1 and 2.**

**✅ APPROVED — the domain model.** [docs/DOMAIN.md](docs/DOMAIN.md) §1–§7 and all of [docs/TENANCY.md](docs/TENANCY.md). Settled and built to in Phase 1:

- The `org → gst_registration → brand → store → outlet → terminal` hierarchy, and the **outlet-boundary rule**: *an Outlet is the smallest unit with its own inventory pool AND its own kitchen (KOT printer set).* Two floors sharing a kitchen = one outlet, two areas. Separate kitchens = two outlets. **A cash drawer belongs to a terminal, not an outlet** — two tills is not evidence of two outlets.
- The `memberships` scope model and the 15-case adversarial RLS suite.
- The `store`-keyed override chain with binary specificity weights, and the 21-row precedence table.
- The four state machines (order, table session, KOT, bill). **KOT ≠ Bill**, structurally.
- The business-day rule (partial unique index = the enforcement mechanism; no open day → no bill).
- The money rules — **integer paise, tax components computed independently at their own rates** — and every worked example in §7, which are now the `packages/domain` fixtures.
- GSTIN-scoped invoice numbering, reserved blocks, the gap register.

**⏸ PARKED — offline conflict rules** ([docs/DOMAIN.md](docs/DOMAIN.md) §8). Sign-off deferred.

**Offline-first billing remains fully in scope and still ships in Phase 3b.** What is parked is the *approval of the per-entity conflict table*, not the feature. Nothing changed in the PRD or the roadmap.

> **⚠️ This must be approved before Phase 3b begins.** The conflict rule for each entity determines its **schema** — append-only vs. mutable — so getting it wrong is a migration, not a patch. **Phases 1, 2, 3a and 4 do not depend on it and proceed normally.**

The unresolved question, when we come back to it: whether the per-entity split holds, or whether a simpler global rule is worth the cost. My position is that no global rule works — `order_items` must **merge** (LWW loses a guest's food) while `table_session` close must **reject** (LWW *is* the "table occupied after the guests left" bug). They want opposite things.

---

## 2026-07-13 — Design direction: **B, "Service Board"** ✅ APPROVED

**Decided by:** Mohammed. **Gate item 3 of 3 — closed.**

Enamel green, graphite, one brass accent. **The signature element is the state rail:** every entity — a table, a ticket, a bill row, an outlet in a report — carries a 4 px rail on its leading edge, and **the rail's colour *is* its state. Nothing else in the interface encodes state with colour.**

**Tokens** (canonical — Phase 1 builds the token layer from these):

| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#0C1517` | Dark ground (POS chrome, KDS) |
| `--enamel-700` | `#0E4F45` | Brand green. Headers, primary surfaces, **text on light** |
| `--enamel-500` | `#17796A` | Live / fresh / OK |
| `--brass-500` | `#C89B3C` | The one warm accent. Primary action, focus ring, the rail |
| `--chalk-50` | `#EDF1EF` | Light ground (Console, Booth) |
| `--signal-600` | `#C63A2A` | Destructive: void, 86, critical age |

Type: **Bricolage Grotesque** (display) · **Inter** (body/UI) · **IBM Plex Mono** (data, tabular).

**Rail fill — the time-temperature ramp** (grafted from Direction C): `#17796A` fresh → `#D9A32B` warming → `#D2622A` hot → `#C63A2A` critical (hatched). **Colour is never the only channel** — the rail always sits beside a numeric age, and critical adds a diagonal hatch.

**Two constraints that are rules, not preferences:**
1. **Brass fails AA on light (2.2:1).** Brass is a **fill** — the rail, a focus ring, a button face with dark text on it. **Never light-mode text.** Enamel-700 (7.6:1) carries text on `--chalk-50`. **This becomes a lint rule in Phase 1**, or someone ships a brass link on a white page in Phase 9.
2. **POS and KDS have zero animation.** `transition: none` on the entire subtree. A 200 ms transition on a billing screen is a bug. Speed is the aesthetic there.

**In scope, carried over from the directions that lost:** the Booth's split-flap order-status board (from A — motion in the one place motion belongs), and the time-temperature ramp (from C).

**Rejected:** A (Ticket Rail) — its perforation is decoration that eats vertical pixels on the KDS, the one screen where every pixel is a ticket you can or cannot see. C (Living Map) — isometry is inefficient with screen area at POS density and has to be abandoned there, so its signature fails the three-density constraint; and it spends the whole colour budget on one semantic axis, which collides with India's legally-coded veg/non-veg marks.

**The trade we knowingly accepted:** B is quiet. It will not win a design award and will not make a great screenshot. C would. We chose the person who stares at it for ten hours over the person who looks for ten seconds.

Full argument: [docs/DESIGN.md](docs/DESIGN.md) · [artifact](https://claude.ai/code/artifact/e8f97323-647d-48eb-b462-d25ca38ca37a)

---

## 2026-07-13 — Three corrections to the brief, amended in place

**Decided by:** Mohammed. Recorded in the **Phase 0 amendments** changelog at the top of [RESTROBOOTH_BRIEF.md](RESTROBOOTH_BRIEF.md).

1. **Menu overrides key on `store`, not `outlet`.** The brief contradicted itself; `store` = (brand × outlet) is the only correct key in the multi-brand cloud-kitchen case. Precedence is a total order via binary specificity weights (promo 8, daypart 4, channel 2, store 1).
2. **"Free tier throughout" is not achievable.** Vercel Hobby is non-commercial, and its own definition includes *"processing payment from visitors"* — which the Booth does at **Phase 5**. Free tier is a dev environment. Real cost ~$45/mo. Binding rule: **no Supabase- or Vercel-specific API in `packages/domain` or any UI component.**
3. **Phase 8 hard gate.** Chain features (central kitchen, royalty, cluster dashboards) do not begin until a real restaurant has run a real service. Written into [CLAUDE.md](CLAUDE.md) because a gate that depends on willpower in six weeks is not a gate.

---

## 2026-07-13 — Phase 0 architecture decisions

All eight of the brief's §10 open decisions resolved. See [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md) Part 2 for the reasoning; ADRs in [docs/adr/](docs/adr/).

Two are **PROVISIONAL** pending benchmarks that Phase 1 runs as its first task ([docs/BENCHMARKS.md](docs/BENCHMARKS.md)):
- **ADR-0006** — live override resolution, pending **BENCH-02**
- **RLS via `STABLE` + `(select …)` InitPlan hoist**, pending **BENCH-01**

**A provisional ADR still provisional at the end of Phase 1 is a process failure, not a pending task.**
