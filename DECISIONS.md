# RestroBooth — Decision Log

Append-only. Newest first. One entry per decision that a future session would otherwise re-litigate.

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
