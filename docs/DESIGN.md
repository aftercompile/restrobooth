# RestroBooth — Design Directions

**Status: ✅ DECIDED — 2026-07-13. Direction B, "Service Board", is approved and is the design system.**
A and C remain below as the record of what was considered and why they lost. **Do not re-litigate them; do not mix them.** The two grafts from A and C listed under the recommendation (the Booth split-flap board; the time-temperature ramp as the rail's fill) are **in scope** and are part of B.

> **Amendment — 2026-07-19, "Phase 4.5" redesign.** After Phase 4, real use of the POS surfaced two layout bugs (floor-plan table cards overlapping, a white strip below short pages — both traced to missing global CSS, not to the design system) and the owner asked for a lighter, more minimalist re-skin with animation and doodles in the background. **This is a re-skin of Direction B, not a new direction** — the state rail, the three-density spacing/size/motion system, and the enamel/brass brand palette are unchanged. What changed:
> - **Ground.** POS and KDS drop `--ink-900` (dark) for the same warm-paper ground Console/Booth already used. **One light theme across all four apps** — no more per-density dark/light fork in the token layer.
> - **A second, quieter signature.** A fixed, CSS-only layer of low-opacity kitchen doodles (whisk, chilli, mint leaf, steam curl, fork+knife, cup, sparkle) sits behind all content in every app. It **coexists with, and never competes with, the state rail** — the rail still owns state; the doodles own nothing but ambience.
> - **The zero-motion rule is refined, not repealed.** "POS/KDS have zero animation" (§"How B works at each density" below, and CLAUDE.md) now reads precisely: **zero motion on working content** (the floor, the bill, the KDS board — unchanged, still `transition: none` on the subtree) **but CSS-only ambient background motion is allowed on light/non-dense surfaces** — in practice, only `/login` routes, gated by the same `useMotionAllowed()` that already governs Console/Booth motion (which is itself gated on density and `prefers-reduced-motion`). A cashier's or captain's own login screen is still a work surface, not a marketing moment, so it stays static too — motion only actually appears on Console's login.
> - See [DECISIONS.md](../DECISIONS.md) for the full rationale and the accessibility retuning this forced (e.g. the state rail's `critical` hatch, and KDS's `itemQty` accent colour, both had to move off tokens that were only AA-safe *because* the ground used to be dark).

> **Amendment 2 — 2026-07-19, POS floor-view redesign.** A follow-up pass, scoped via `AskUserQuestion` before building (two explicit forks, both decided by the owner): the POS floor grid specifically — not any other POS screen — gets two exceptions to standing rules, confirmed in DECISIONS.md.
> - **Motion.** The floor grid's table-card lifecycle (hover, press, a status change) now gets restrained 150–200ms CSS transitions. **This does not repeal "zero motion on working content"** — the order pad, bill, and menu screens are unaffected, still hard-`transition: none`. It's a single, narrowly-scoped selector (`apps/pos/app/floor/FloorMap.module.css`'s `.floorMotionScope`) that out-specifies `tokens/motion.css`'s blanket POS kill-switch rather than weakening it, so nothing else in POS can accidentally inherit motion by drifting into the same file or class name.
> - **Status chip, floor cards only.** The floor grid's table cards replace the left-edge state rail with a compact top-of-card chip (colour + dot + text label, same `--ramp-*` tokens the rail itself reads — one palette, a second presentation) — a real fix for a real complaint (the rail was costing meaningful width across a dense grid of narrow cards). **The rail is still the system's one signature everywhere else** — KDS tickets, the POS Menu list, Captain's floor list all keep it unchanged. This was a scoped decision, not the rail being retired.
> - Also: the ambient doodle opacity dropped slightly (0.16 → 0.11, "barely visible" per the brief), the ramp legend got shorter labels with a hover tooltip for the exact minute thresholds (it was eating header width), and the header itself got a taller (68px) segmented-tab treatment with an avatar menu — none of that touches money/tickets and needed no rule changes.

> **Amendment 3 — 2026-07-19, surface hierarchy & elevation, the Live Header.** A design-consultancy pass on the POS screens the floor-view redesign hadn't reached yet (order pad, bill, day, menu — still hairline-divider forms next to the now-tactile floor). Three forks confirmed via `AskUserQuestion` before building.
> - **Surface hierarchy & elevation, formalized in the token layer** (`packages/ui/src/tokens/colors.css`): `--surface` (raised) vs. `--surface-sunken` (recessed — deepened from `#efede7` to `#ebe8df`, re-measured at 4.57:1 for `--text-muted`, still ≥AA) is now a deliberate *direction* pair, not two shades of the same flat. Elevation is a real 3-step ramp — `--elevation-1/2/3`, a two-layer shadow (tight contact + soft ambient) plus `--highlight-top` (a top inner highlight for the "physical" edge) — reused everywhere via `Card`'s new `interactive` prop rather than a bespoke shadow per screen.
> - **This explicitly overrides "elevation through layered surfaces, not heavy shadows" / "deliberately shallow: this is a back office, not a landing page"** (`Card.module.css`'s original comment) — the owner chose richer/more pronounced over restraint, knowingly. The replacement principle: **one disciplined ramp, reused everywhere, is still "engineered," just no longer shallow.**
> - **No new motion exception.** Depth is static. Hover/press *state changes* were already allowed everywhere in POS (`Button`'s `:active { filter }`, `DataRow`'s `:hover` predates this pass) — what's banned is *animating* them, and that's unchanged: `Card.interactive`'s transition is written as a plain CSS transition with no scoping trick, because `tokens/motion.css`'s existing blanket `[data-density="pos"] * { transition: none !important }` already forces it to snap instantly there and only animates on Console/Booth. The floor grid's `.floorMotionScope` (Amendment 2) is untouched and still the only place POS itself animates.
> - **The Live Header** (`PosShell.tsx`, now an async Server Component) adds a context strip (business date + outlets-open count, from the same `getDayStatuses()` the Day page already calls), a search field (table-label filter via a `?q=` param `FloorMap` reads; invoice-number lookup via a new small query, `header-queries.ts`), and an alerts badge (aggregates the *existing* offline/rejected outbox signal `OfflineStatusBar` already reads, plus a new `getAwaitingPaymentCount()` query — reusing the floor's own "printed but unpaid" definition). **No notification system, no fuzzy global search, no invented metric** — every number on the header is either already queried elsewhere or one small, real query away.

See "How B works at each density" below for the updated per-density table (Ground/Motion rows) reflecting the first amendment; the floor-grid motion exception above is narrower than a density-level change and isn't reflected in that table on purpose — it's one page, not a density.

**Next:** Phase 1 implements the token layer and the first 10 UI primitives against this. The brass-fails-AA-on-light constraint (§Direction B) becomes a lint rule, not a code-review note.

**Last updated:** 2026-07-13
**Interactive version:** see the published artifact linked at the end — real swatches, live type specimens, and a mock screen per density per direction. **Judge from that, not from these hex codes.**

> **Note on the brief.** §7 says to read the `frontend-design` skill. That skill does not exist in this environment; the closest is `ui-ux-pro-max`, which I used for the quality floor (contrast, touch targets, tabular numerals, reduced-motion, no colour-only meaning). Its palette/font database I deliberately did **not** use for the directions themselves — a generic palette database is precisely where the banned "AI-design tells" come from. The three directions below are designed, not retrieved.

---

## 0. The constraints, restated as tests

Not aspirations. Each is pass/fail.

| Constraint | Test |
|---|---|
| **One design system, three densities** | The same tokens produce Booth (generous, cinematic, motion-rich), POS+KDS (dense, high-contrast, **animation-free**), and Console (editorial, calm). If a direction needs *different tokens* per surface, it has failed. |
| **Spend the boldness in one place** | Name the signature element in one sentence. If you can't, there isn't one. |
| **Not a template** | Fails the banned list below. |
| **Quality floor** (unannounced, non-negotiable) | WCAG AA contrast; visible keyboard focus; `prefers-reduced-motion` respected; 44 px touch targets on POS; responsive to mobile; **tabular numerals wherever numbers stack**. |

**Banned, and why each is banned:** cream `#F4F1EA` + high-contrast serif + terracotta `#D97757`; near-black + single acid-green accent; hairline-rule broadsheet layout; purple→blue gradient hero; glassmorphism cards; floating 3D blobs; "Trusted by 10,000+" bar; `01 / 02 / 03` numbered sections. These are the current AI-design defaults. **They read as a tell**, and a restaurateur evaluating a POS in the first four seconds will read them as one.

**A note on why "animation-free POS" is a design decision and not a limitation:** a 200 ms transition on a billing screen is a bug. The cashier presses a key 400 times a shift; every one of those 400 presses must land instantly. **Speed is the aesthetic there.** Any direction that needs motion to feel finished has failed the POS density, and I have critiqued each direction on exactly that.

---

## Direction A — **Ticket Rail**

*The KOT ticket as the atomic visual unit. The entire system is a rail of tickets.*

The restaurant's native document is not a dashboard card — it's a ticket. So the ticket becomes the layout primitive: a fixed-measure column, a perforated top edge, a monospace data spine down the right. The app ground is the dark board the tickets hang on; the tickets themselves are white and printed.

Inverting the obvious (dark board, white ticket — rather than cream "receipt paper" everywhere) is what keeps this out of skeuomorphic-kitsch territory, and it is also what dodges the banned cream palette by construction.

### Tokens

| Token | Hex | Use |
|---|---|---|
| `--rail` | `#1E242C` | App ground — the board the tickets hang on |
| `--ticket` | `#FFFFFF` | The ticket surface |
| `--ink` | `#14171C` | Text on ticket |
| `--thermal` | `#E8462B` | The second colour a thermal printer can actually print. **Void / 86 / late only.** |
| `--fire` | `#F2A93B` | Ticket aging, warning |
| `--go` | `#2E9E6B` | Bumped, ready, paid |

**Type:** display **Archivo** · body **Inter** · data **IBM Plex Mono** (tabular)

### Signature element
> **The perforation.** A CSS-rendered notch edge that divides *any* two stacked records — tickets on the KDS, line items on a bill, rows in a report. It is a border style, not an illustration, so it costs nothing and appears everywhere.

### ASCII

```
┌─ POS ────────────────────────────────────────────────┐
│ ╭┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮   Table 12 · 4 covers   [F2 KOT]  │
│ │ ░ TICKET #0412│   ─────────────────────────────── │
│ ╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╯   Butter Chicken  ×2     760.00  │
│  Butter Chicken ×2   Naan            ×4     240.00  │
│  Naan           ×4   Coke            ×2     240.00  │
│  ⌐ 04:12 ago         ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ ╭┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╮    Subtotal              1240.00  │
│ │ ░ TICKET #0413│    CGST 2.5%               31.00  │
│ ╰┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈╯    SGST 2.5%               31.00  │
│  Paneer Tikka   ×1   Round off              −0.40   │
│  ⌐ 00:48 ago         TOTAL                 1302.00  │
└──────────────────────────────────────────────────────┘
     ↑ the rail            ↑ mono data spine, tabular
```

### Critique
- ✅ Rooted in the restaurant's own material culture; nothing on the banned list; genuinely distinctive.
- ✅ The Booth version is lovely — a **split-flap/Solari board** for live order status is an obvious, delightful extension of the ticket idea, and it's the one place motion earns its keep.
- ❌ **The signature actively hurts the surface that matters most.** A perforated divider is *decoration that consumes vertical pixels* on the KDS, which is the one screen where every pixel is a ticket you can or cannot see from 2 metres. The signature is at its weakest exactly where the product is at its most critical.
- ❌ Mono-as-texture drifts toward "developer aesthetic," which is its own 2026 tell. Containable (confine mono to numerals) but it is a pull in the wrong direction.
- ⚠️ Risk of tipping into diner-nostalgia pastiche. This must be an Indian restaurant OS, not an American diner theme.

---

## Direction B — **Service Board** ⭐ *recommended*

*The material language of a working commercial kitchen: enamel, steel, and a brass rail. Industrial precision, not nostalgia.*

The reference is not a diner — it's the Irani café, the railway refreshment room, the enamel signage of an Indian F&B interior, and the steel gantry of a hot line. Deep enamel green, graphite steel, one brass accent. Restrained, adult, and unmistakably of this industry rather than of the SaaS industry.

### Tokens

*Superseded by the 2026-07-19 amendment above — this is the token table as originally decided (dark POS/KDS ground). The live token set is `packages/ui/src/tokens/colors.css`; see the amendment for what changed.*

| Token | Hex | Use |
|---|---|---|
| `--ink-900` | `#0C1517` | ~~Dark ground (POS chrome, KDS)~~ — retired; all four apps now share `--bg` |
| `--enamel-700` | `#0E4F45` | Brand green. Headers, primary surfaces, **text on light** |
| `--enamel-500` | `#17796A` | Live / fresh / OK state |
| `--brass-500` | `#C89B3C` | **The one warm accent.** Primary action, focus ring, the rail. |
| `--chalk-50` | `#EDF1EF` | ~~Light ground (Console, Booth)~~ — retired; renamed/retuned to `--bg` (`#F6F4EF`), now the ground everywhere |
| `--signal-600` | `#C63A2A` | Destructive: void, 86, critical age |

**Current, live palette:** `--bg #F6F4EF` (warm paper ground, all apps) · `--surface #FFFFFF` (card fill) · `--surface-sunken #EFEDE7` · `--text #12201D` · `--text-muted #5C6B66` · `--border #E2E0D8` / `--border-strong #CDCBC2` · `--ambient-doodle #A8B6AC` (the background-doodle stroke). Enamel, brass, signal, and the ramp are unchanged from the table above.

**Type:** display **Bricolage Grotesque** · body **Inter** · data **IBM Plex Mono** (tabular)

Inter is boring **on purpose**: at POS density you want a typeface with no opinions. The display face carries all the character, and it only appears on Booth and Console.

**An honest constraint that falls out of the palette, and that I am stating rather than discovering later:** brass on chalk is **2.2:1 — it fails AA for text.** So **brass is never a text colour on a light background.** It is a *fill* — the rail, the focus ring, a button face with dark text on it. On dark grounds brass reaches 6.4:1 and is safe for text. Enamel-700 on chalk is 7.6:1 and is the light-mode text/link colour. This is a real rule, it is enforceable in the token layer, and a direction that hasn't worked it out is a direction that will fail an audit in Phase 10.

### Signature element
> **The state rail.** Every entity — a table, a ticket, a bill row, an outlet in a report — carries a 4 px rail on its leading edge. **The rail's colour and fill level *is* the entity's state.** Nothing else in the interface is allowed to encode state with colour.

One primitive. It is the table's edge on the floor map, the ticket's edge on the KDS, the row's edge in the console. It costs 4 pixels, it never competes with content, and it means a cashier, a chef, and an owner are all reading **the same visual language** for "this needs attention."

**Grafted from Direction C** (and I'd rather say so than pretend I invented it in isolation): the rail's fill uses a **time-temperature ramp** — cool when fresh, hot when late.

`#17796A` fresh → `#D9A32B` warming → `#D2622A` hot → `#C63A2A` critical

**Colour is never the only channel.** The rail always sits next to a numeric age (`04:12`), and the critical state adds a diagonal hatch — so it survives colour-blindness and a greasy, glare-lit kitchen screen. (`ui-ux-pro-max` §1: `color-not-only`.)

### ASCII

```
┌─ KDS (dark, dense, zero motion) ─────────────────────┐
│ ▍#0412  T12 · 4pax          04:12   [SPACE = bump]  │
│ ▍ 2  Butter Chicken                                  │
│ ▍ 4  Naan            ← 4px brass rail = warming      │
│ ▍ 2  Coke                                            │
│ ▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚ │
│ ▍#0413  T07 · 2pax          18:40 ⚠ hatched = late  │
│ ▍ 1  Paneer Tikka                                    │
└──────────────────────────────────────────────────────┘

┌─ Floor (same rail, now the table's edge) ────────────┐
│   ▛▀▀▜  ▛▀▀▜  ▛▀▀▜        ▍ = the same 4px rail,    │
│   ▌ 4▐  ▌ 2▐  ▌ 6▐          same ramp, same meaning │
│   ▙▄▄▟  ▙▄▄▟  ▙▄▄▟                                   │
│   04:12  ——   22:05 ⚠                                │
└──────────────────────────────────────────────────────┘
```

### Critique
- ✅ **The signature is information, not decoration.** It is the only one of the three that makes the *dense* surfaces better rather than merely tolerating them. That is the decisive point: POS and KDS are where this product lives or dies, and a signature that costs them nothing and tells them something is the only kind worth having.
- ✅ Survives all three densities as one system: the rail is 4 px on the KDS, 6 px on a Console row, and becomes the glowing edge of a table on the Booth's "your order" card.
- ✅ Nothing on the banned list. Enamel green + brass is not a 2026 AI default; it's the colour of the actual industry.
- ✅ Colour budget stays free. Because *only* the rail encodes state, the rest of the interface can be quiet — which is exactly what "spend the boldness in one place" means.
- ❌ **Quieter than A or C.** It will not win a dribbble shot. A restaurateur will not gasp at a screenshot. (I think that is the correct trade for software someone stares at for ten hours, and I'd rather defend a boring POS than a beautiful one — but it is a real cost and you should make the call knowing it.)
- ❌ Enamel + brass could tip "heritage/colonial" if the photography and copy go wrong. Mitigation: contemporary Indian food photography, sentence case, zero ornament, no serif anywhere.
- ⚠️ The brass-fails-AA-on-light constraint is real and must be enforced in the token layer, or someone will ship a brass link on a white page in Phase 9.

---

## Direction C — **Living Map**

*The floor plan as the hero. The restaurant as an organism you can watch breathe.*

An isometric, living map of the room. Tables pulse with occupancy; orders animate from table to kitchen. The organising idea is a single **colour-temperature scale mapped to elapsed time** — and, crucially, that same scale is reused everywhere time matters: table dwell, KDS ticket age, ticket-time anomaly, the console's hourly heatmap.

**Warmth = elapsed time = attention needed.** One scale, one meaning, every surface.

### Tokens

| Token | Hex | Use |
|---|---|---|
| `--void` | `#101418` | Ground |
| `--surface` | `#191F26` | Cards, map plane |
| `--t-fresh` | `#1F6F9E` | Just seated / just fired |
| `--t-ok` | `#4FA88C` | Nominal |
| `--t-warn` | `#E0A32E` | Attention |
| `--t-late` | `#D2452F` | Late |
| `--paper` | `#E6EAEF` | Text / light surfaces |

**Type:** display **Space Grotesk** · body **Inter** · data **IBM Plex Mono**

### Signature element
> **The occupancy pulse.** A continuous cool→warm temperature ramp bound to elapsed time, driving every time-sensitive surface in the product — and an isometric floor map where the room is literally visible.

### ASCII

```
┌─ Floor (the hero) ───────────────────────────────────┐
│         ◢◤ ◢◤                                        │
│      ◢◤T4◥◣  ◢◤T5◥◣       ▁▂▃▄▅▆▇ cool ──→ hot      │
│      ◥◣__◢◤  ◥◣__◢◤        0min      45min          │
│         ◥◤ ◥◤                                        │
│      ◢◤T1◥◣  ◢◤T2◥◣  ◢◤T3◥◣                          │
│      ◥◣__◢◤  ◥◣__◢◤  ◥◣__◢◤                          │
│       04:12   22:05    ——                            │
│        cool     hot   empty                          │
└──────────────────────────────────────────────────────┘
```

### Critique
- ✅ **The most functionally motivated idea of the three.** It encodes the thing the product genuinely cares about (elapsed time → attention) directly into colour, and it is reused across four real features that already exist in the roadmap.
- ✅ Spectacular on the Floor surface, and a genuinely great demo.
- ❌ **It spends the entire colour budget on one semantic axis.** Once cool→warm means *time*, colour can no longer safely mean *anything else* — not brand, not category, not veg/non-veg (which in India is a **legally-coded green/brown mark** and cannot be negotiated with). That is a serious, permanent constraint on every future screen, and I don't think it's worth it.
- ❌ **Isometric is a trap at POS density.** An isometric map is beautiful and it is *inefficient* with screen area — the exact wrong trade on a tablet at 9 PM. It would have to degrade to a plan view on POS, which means the signature does not actually survive all three densities. That is a failure of the core constraint, not a detail.
- ❌ A dark-first system in a **brightly-lit dining room** is a glare and legibility problem. Kitchens are bright. This wants dimming, and dimming is not available.
- ⚠️ Colour-as-sole-meaning is an accessibility violation waiting to happen and would need numeric labels everywhere anyway — at which point the colour is doing less work than it appears to.

---

## Recommendation: **Direction B — Service Board**

**Defence, in one line:** it is the only direction whose signature element makes the *dense* surfaces better instead of merely surviving them — and the dense surfaces are the product.

The longer argument:

1. **POS and KDS are where RestroBooth lives or dies.** A cashier looks at the POS for ten hours; a chef reads the KDS across a hot line. Direction A's perforation costs pixels there. Direction C's isometry costs area there and has to be abandoned. **Direction B's rail costs 4 px and tells you something true.** That asymmetry decides it.

2. **The signature is information.** "Spend the boldness in one place" is usually read as *put one beautiful thing on the page*. The stronger reading is *put one meaningful thing everywhere*. The state rail is a single primitive that a cashier, a chef, and an owner all learn once and read on every surface. Nothing else in the interface is permitted to encode state with colour — which is what buys the rest of the UI its quietness.

3. **It survives all three densities with one token set** — the actual constraint. 4 px on KDS, 6 px on a Console row, a glowing card edge on the Booth. The scale changes; the meaning does not.

4. **It leaves the colour budget free**, which C does not. Veg/non-veg marks in India are legally colour-coded and non-negotiable; a system that has already spent green on "time" is a system fighting the law of the land on every menu screen. This is not a hypothetical.

5. **It refuses every banned default** without trying to, because it is derived from the material culture of the actual industry rather than from a palette database.

**What I'm taking from the losers, rather than discarding them:**
- **From C:** the time-temperature ramp, as the rail's fill. It is the best single idea in this document and it deserves to survive its direction. (Constrained: it drives *only* the rail, never the whole surface.)
- **From A:** the split-flap order-status board on the Booth. It is a delight, it is motion in the one place motion belongs, and it survives the transplant intact.

**What I am explicitly giving up, so you can overrule me:** Direction B will not win a design award and it will not make a good screenshot. It is *quiet*. If the goal is a product that makes a restaurateur gasp in a demo, C is the better choice and I would build it without complaint. **I am recommending B because I think the person who has to look at it for ten hours matters more than the person who looks at it for ten seconds** — but that is a judgment about who we are building for, and it is yours to make, not mine.

---

## How B works at each density

Same tokens. Three spacing scales, three motion budgets.

| | **Booth** (guest) | **POS + KDS** | **Console** |
|---|---|---|---|
| Ground | `--bg`, photographic | `--bg` *(was `--ink-900` — see 2026-07-19 amendment)* | `--bg` |
| Spacing scale | 24 / 32 / 48 / 64 / 96 | **8 / 12 / 16 / 24 / 32** | 16 / 24 / 32 / 48 / 64 |
| Base type | 18 px | 15 px, tabular numerals | 16 px |
| Touch target | 48 px | **44 px minimum, enforced** | n/a (pointer) |
| Working-content motion | Full. Split-flap status board, staggered menu reveal, 200–400 ms spring | **ZERO.** `transition: none` on the entire subtree. Speed is the aesthetic. | Restrained. 150 ms, ease-out, opacity/transform only |
| Ambient background motion | Doodle layer animates freely | **ZERO everywhere**, including its own `/login` — a work surface stays calm even at the door | Doodle layer animates only on `/login`; static on dense working pages |
| The rail | Glowing card edge on "your order" | 4 px, the primary state channel | 6 px on table rows |
| Display face | Bricolage Grotesque, large | **never used** — Inter only | Bricolage Grotesque, restrained |

**`prefers-reduced-motion` collapses Booth to the Console motion budget, and disables the ambient doodle layer everywhere it would otherwise animate.** POS and KDS working content is already at zero, so it is unaffected — which is a small, pleasing proof that the animation-free decision was right on its own merits and not merely an accessibility concession. The ambient layer is governed by the same `useMotionAllowed()` used for Console/Booth content motion (`packages/ui/src/motion.tsx`), so this is one guard, not two.

---

## Quality floor — enforced in the token layer, not left to reviewers

- **Contrast:** every text/background pair in the artifact is AA-verified. The brass-on-light failure is documented above and encoded as a lint rule: **brass is a fill, never light-mode text.**
- **Focus:** 3 px `--brass-500` ring, 2 px offset, on every interactive element. **Never removed** — on the POS it is the primary navigation affordance, because the cashier is keyboard-first and the focus ring is how they know where they are.
- **Touch:** 44 px minimum on POS, 48 px on Booth.
- **Numerals:** `font-variant-numeric: tabular-nums` on every price, quantity, timer, and total. **Non-negotiable** — a total that shifts by a pixel as it counts is a total that looks wrong.
- **Motion:** `prefers-reduced-motion: reduce` honoured globally.
- **Icons:** one family (Phosphor), consistent stroke. **No emoji, ever.**

---

## The artifact

The three directions rendered with real swatches, live type specimens, the temperature ramp, and a mock POS / KDS / Booth / Console screen each — **published as an interactive page. Judge from that.** Hex codes in a table are not a design, and you are being asked to approve a design.

▶ **[View the three directions](https://claude.ai/code/artifact/e8f97323-647d-48eb-b462-d25ca38ca37a)**

*(Caveat, stated on the page too: the artifact sandbox blocks external font CDNs, so the specimens render in system faces. The named typefaces are the specification, not what you are looking at. Colour, the rail, the temperature ramp, and the density behaviour — the things that actually decide this gate — are exactly as they would ship.)*
