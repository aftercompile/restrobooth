# RestroBooth — Progress

Maintained at the end of every session so the next one starts warm. Current state, not history — see [DECISIONS.md](DECISIONS.md) for the append-only decision log and `git log` for what actually changed.

---

## Where things stand — 2026-07-14, end of Phase 1

**Phase 1 is done.** Per [CLAUDE.md](CLAUDE.md)'s pilot path (Phase 1 → 2 → 3a → 3b → 4 → 5 → PILOT), Phase 2 is next.

### What exists and works right now

- **Monorepo**: pnpm + Turborepo. `apps/{console,pos,kds,booth,captain}` (empty Next.js shells except console, which has `/style-guide`). `packages/{db,ui,domain,config,ai,channels}`; `domain`/`ai`/`channels` are still empty, correctly-configured shells (Phase 2+/3b work).
- **`packages/db`**: full schema (36 tables), RLS on every table (partitions included — each partition's `relrowsecurity` is set explicitly by `create_partitions_ahead()`, since enabling RLS on a partitioned parent does not propagate to children), `resolve_menu()`, the believable-chain seed (`pnpm seed`), and the 9M-row bench fixture generator (`bench/seed.ts`).
- **Both correctness suites pass** against a real Supabase CLI local stack (real GoTrue `auth.uid()`, not the dev stub): 15-case RLS adversarial suite (`test/rls/`, 4 cases `test.skip` with documented reasons — see below) and the 21-row override precedence table (`test/override/`), all green.
- **Both benchmarks pass** — see [docs/BENCHMARKS-RESULTS.md](docs/BENCHMARKS-RESULTS.md). ADR-0006 and the RLS mechanism (TENANCY.md §4) are both **CONFIRMED**, not provisional.
- **Design tokens + all 10 UI primitives** for Direction B ("Service Board") exist in `packages/ui` and render on `/style-guide` in `apps/console`, verified via clean `next build` + HTTP content checks across all four density sections (Console/POS/KDS/Booth). **Not yet visually inspected by a human** — see gaps below.
- **CI**: three GitHub Actions workflows exist (`.github/workflows/`) — per-PR (lint/typecheck/build + a plain-Postgres drift/partitions job + a Supabase-CLI-stack RLS-suite job), a scheduled daily staging partitions check (no-ops until a real staging project exists), and a manual benchmark re-run. **Not yet run for real** — see gaps below.

### Local environment, for picking this back up

- **docker-compose Postgres** on port 54329 (`restrobooth`/`restrobooth`) — day-to-day schema dev, has the local `auth.uid()` stub. Also currently holds the full 9M-row bench fixture (2.27M orders, 9.1M order_items) — regenerate via `packages/db/bench/seed.ts --scale=full` if it's gone.
- **Supabase CLI local stack** — installed at `C:\Users\Mohammed\bin\supabase.exe`, direct Postgres on port 54322 (`postgres`/`postgres`), Studio on 54323. Start with `supabase start` from the repo root. This is what the RLS/override test suites actually run against (`TEST_DATABASE_URL` env var, defaults to this).
- Both databases have all 10 migrations applied (`packages/db/drizzle/0000`–`0010`).

### Known gaps — not silently closed, need a human or a follow-up session

1. **No one has looked at `/style-guide`.** This environment has no screenshot/browser tool. CLAUDE.md rule 11 ("screenshot the UI and critique it before showing it") could not be honored. Start the dev server (`pnpm --filter @restrobooth/console dev`) and open `localhost:3000/style-guide` — genuinely look at it before trusting it's not template-shaped.
2. **CI has never actually run.** The three workflow YAML files are syntactically valid and every step was verified locally with equivalent commands, but nothing has executed inside GitHub Actions — that needs a push, which this session didn't do (commits only, per standing instruction). First push to a branch/PR will be the first real signal.
3. **A6, A7, A9, A14 of the RLS suite are `test.skip`, not passing.** Role-capability checks (a cashier can't reprice, a captain can't bill) and QR-token-replay — ROADMAP.md itself scopes these to Phase 2/3a/5, so this is expected, not a bug, but Phase 2 planning should re-read `test/rls/adversarial.test.ts`'s header comment before assuming they're covered.
4. **Two BENCH-02 fixture gaps**, documented in BENCHMARKS-RESULTS.md: `bench/dimensions.ts`'s override rows don't vary by channel or reference dayparts/promos, so R2 and R3 don't fully exercise what their names claim to test. Worth closing if channel/daypart-scoped overrides become a Phase 2 feature under real load.

### Not yet pushed

All Phase 1 work is committed to `main` locally (commits `d2ce231` … `139c511`). **Nothing has been pushed to origin.** Ask before pushing, per standing instruction.

---

## Next up: Phase 2

Not started. Re-read [docs/ROADMAP.md](docs/ROADMAP.md) §2 and [docs/OPEN-DECISIONS.md](docs/OPEN-DECISIONS.md) at the start of that session — this file only covers Phase 1's exit state, not Phase 2's plan.
