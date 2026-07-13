# RestroBooth — Standing Rules

A cloud restaurant OS for the Indian F&B market. Multi-outlet, multi-brand chains from day one.

**Read [RESTROBOOTH_BRIEF.md](RESTROBOOTH_BRIEF.md) at the start of every phase.** It carries a **Phase 0 amendments** changelog at the top — three things in the original text were wrong and are corrected in place. Do not re-introduce them.

Phase 0 is complete. The architecture lives in [docs/](docs/). **[docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md) is the fastest way to get warm.**

---

## ⛔ The gate

> **Phase 8+ (central kitchen, franchise royalty, cluster dashboards) does not begin until a real restaurant has run a real service on RestroBooth. Not a demo. A service — real guests, real money, a real day close.**

**At every phase review, ask: *would the pilot restaurant notice this feature's absence?* If no, it is not v1.** Apply it ruthlessly.

**Why this rule exists, and why it is here rather than in a doc:** the chain features are the *fun* ones. Central kitchen, inter-GSTIN transfers, network benchmarking — genuinely interesting engineering. Billing a table of four correctly at 9 PM with the WiFi down is not. It is fiddly, unglamorous, and it is **the entire product.** Without a gate, the work drifts toward the interesting problems and it feels productive the whole way. That is the single most likely way this project dies ([docs/RISKS.md](docs/RISKS.md) R1). A gate that depends on willpower six weeks from now is not a gate — so it is in the file that loads every session.

**The pilot path (the plan of record):** Phases 1 → 2 → 3a → 3b → 4 → 5 → **PILOT**. Everything after is a stretch. ([docs/ROADMAP.md](docs/ROADMAP.md) §2)

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
- **`prefers-reduced-motion` and 44px touch targets** on POS are floor, not polish. **POS/KDS have zero animation** — a 200 ms transition on a billing screen is a bug.

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
