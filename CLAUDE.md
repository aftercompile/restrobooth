# RestroBooth — Standing Rules

A cloud restaurant OS for the Indian F&B market. Multi-outlet, multi-brand chains from day one.

**Read [RESTROBOOTH_BRIEF.md](RESTROBOOTH_BRIEF.md) at the start of every phase.** It carries a **Phase 0 amendments** changelog at the top — three things in the original text were wrong and are corrected in place. Do not re-introduce them.

Phase 0 is complete. The architecture lives in [docs/](docs/). **[docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md) is the fastest way to get warm.**

---

## Status: building ahead of the pilot

Phase 5 is complete. There is no pilot restaurant available yet, and the owner has made a deliberate, informed call ([DECISIONS.md](DECISIONS.md), 2026-07-23) to build Phases 6–10 now rather than wait — overriding the pilot gate that previously stood here. **Money, RLS, offline sync and the domain layer are unaffected**: those non-negotiables below are permanent, not scheduling. What changed is only *when* the AI/channels/inventory/reporting layers get built.

**Current plan of record:** Phases 1 → 2 → 3a → 3b → 4 → 5 → **6 (AI) → 7 (Channels) → 8 (Inventory/Central Kitchen) → 9 (Reports/AI v2) → 10 (Hardening)**, each phase still starting with its own written, approved plan (non-negotiable #1, unchanged). See [docs/ROADMAP.md](docs/ROADMAP.md) §2.

---

## Non-negotiables

1. **Plan before code.** Every phase starts with a written plan, approved. Every non-obvious choice gets an ADR.
2. **`packages/domain` is sacred.** Pure functions, no I/O, no framework, exhaustive tests. All billing, tax, KOT and session logic lives there. *This is what makes offline-first billing tractable: the same money math runs on the terminal and on the server and produces the same paise.* Do not dilute it.
3. **Money is `bigint` paise. Never floats. Server-authoritative. The AI never touches the ledger.** Tax components (CGST, SGST) are computed **independently at their own rates and each rounded half-up** — never compute 5% and halve it.
4. **KOT ≠ Bill.** Separate lifecycles, separate numbering, separate reprint semantics. A reprint increments a counter; it never creates a second KOT.
5. **Business day ≠ calendar day.** `business_date` comes from the open `business_day` row — **never from a client clock.** No open day → no bill (FK-enforced).
6. **Idempotency everywhere.** Every mutation carries a client-generated key. Offline sync, aggregator webhooks and payment callbacks all replay through the same `idempotency_keys` table.
7. **RLS is the security model**, enforced in Postgres. The access function is `STABLE` and every call is wrapped in `(select …)` — **that wrapper is what makes Postgres evaluate it once per statement instead of once per row.** Do not "simplify" it away.
8. **Never invent an API contract.** No real docs for Zomato/Swiggy/a gateway → say so, code to the interface, build the mock.
9. **Write the migration.** Never mutate schema by hand.
10. **Ask before adding a heavy dependency**, and say what it replaces.
11. **Screenshot the UI and critique it** before showing it. If it looks like a template, it is a template.
12. **Flag it when the brief is wrong.** Arguing at Phase 0 beats arguing at Phase 8. (Three such arguments are already in the changelog — that mechanism works, keep using it.)

## Test what breaks

Money · idempotency · RLS · offline sync · timezone and business-date. **Skip tests for CRUD glue.**

The four acceptance tests that are the product:
- **Offline:** kill the network mid-service, bill four tables, reconnect *twice* with an interleaved second terminal → **zero duplicate bills, zero lost items, zero duplicate KOTs, no unexplained invoice gap.**
- **RLS:** the 15-case adversarial suite ([docs/TENANCY.md](docs/TENANCY.md) §6) as real roles against real Postgres. **A8 especially** — brand isolation *inside* a shared cloud kitchen; outlet-scoping alone is not enough.
- **KDS:** drop the socket 30 s during service, fire 5 KOTs → all 5 appear on reconnect. **A disconnected KDS must *look* broken.**
- **Money:** `packages/domain` at 100% line and branch coverage. The worked examples in [docs/DOMAIN.md](docs/DOMAIN.md) §7 are the fixtures.

## Traps that will bite

- **Vercel Hobby is non-commercial.** Its own definition includes *"processing payment from visitors"* — the Booth does that. **Move to Pro at Phase 5**, not at "first paying customer." (~$45/mo all-in.)
- **No Supabase- or Vercel-specific API in `packages/domain` or in any UI component.** This rule is what keeps the hosting decision cheap to reverse.
- **Menu overrides key on `store`, not `outlet`.** (`store` = brand × outlet.) The original brief said outlet; it was wrong.
- **Price and availability resolve independently.** An 86 must not erase a price override.
- **A printed invoice number is immutable.** Never renumber on sync. Gaps are permanent, explained, never reused.
- **`prefers-reduced-motion` and 44px touch targets** on POS are floor, not polish. **Zero motion on POS/KDS working content** — a 200 ms transition on a billing screen is a bug. (Amended 2026-07-19: an ambient CSS-only doodle background layer now exists behind all four apps' content and is allowed to animate on light/non-dense surfaces — in practice only Console's `/login` — via `useMotionAllowed()`. It never touches the floor/bill/board, and POS/KDS/Captain stay static even on their own login screens. See [docs/DESIGN.md](docs/DESIGN.md)'s amendment and [DECISIONS.md](DECISIONS.md).) (Amended again, same day: the POS **floor grid's table cards** — nowhere else — get restrained hover/press/status-change transitions too, confirmed with the owner first. The order pad, bill, and menu screens are untouched. See DESIGN.md's "Amendment 2" and `apps/pos/app/floor/FloorMap.module.css`'s `.floorMotionScope`.) (Amended again: surface depth (`--elevation-1/2/3`, `--highlight-top`, `packages/ui/src/tokens/colors.css`) is now **richer/more pronounced** than the original "deliberately shallow" call — an explicit owner override, not scope creep. This needed **no new motion exception**: `Card`'s `interactive` hover transition is written plainly and the existing POS/KDS kill-switch already snaps it instant there for free. See DESIGN.md's "Amendment 3.") (Amended again, 2026-07-20: within the SAME `.floorMotionScope`, and only there — Captain was not extended — the floor card's notification-band icon now pulses (3s loop) when critical, and swapped-in band content slides up on mount (200ms), confirmed with the owner first. Everything else in the band, and the card/band's own height, stays static. See DESIGN.md's "Amendment 4.") (Amended again, 2026-07-21: same `.floorMotionScope`, same "one small element breathes" idea — the notify band's new "Cooking" state (a session with an active, un-bumped KOT) gets a hand-drawn pot emoji that gently rotates (1.2s loop) instead of sitting static, requested directly by the owner. Nothing else about the band's layout changed. See DESIGN.md's "Amendment 5.")
- **Don't build header chrome (search/alerts/notifications) against invented data.** The POS Live Header (`PosShell.tsx`) is the pattern to copy: every number on it is either an existing query reused (`getDayStatuses()`) or one small, real query away (`getAwaitingPaymentCount()`, `getBillByInvoiceNo()`). No fuzzy search index, no notification service, no metric the schema can't actually answer.

## Where things are

| | |
|---|---|
| Disagreements + all 8 resolved decisions | [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md) |
| Tenancy, RLS, the 21-row override precedence table | [docs/TENANCY.md](docs/TENANCY.md) |
| State machines, money math, offline conflict rules | [docs/DOMAIN.md](docs/DOMAIN.md) |
| Schema, partitioning, constraints | [docs/ERD.md](docs/ERD.md) |
| ADRs 0001–0007 | [docs/adr/](docs/adr/) |
| **Phase 1's first task** | [docs/BENCHMARKS.md](docs/BENCHMARKS.md) |
| Risks, ranked | [docs/RISKS.md](docs/RISKS.md) |
| Design directions (gate: pick one) | [docs/DESIGN.md](docs/DESIGN.md) |

**Maintain `PROGRESS.md` and `DECISIONS.md` at the end of every session so the next one starts warm.**

## Git workflow
After completing any discrete unit of work (a phase, a feature, a bug fix),
automatically run:
  git add .
  git commit -m "<clear, specific message describing what changed>"
Do this without waiting to be asked. DO NOT push automatically.