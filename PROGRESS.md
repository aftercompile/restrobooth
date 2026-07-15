# RestroBooth — Progress

Maintained at the end of every session so the next one starts warm. Current state, not history — see [DECISIONS.md](DECISIONS.md) for the append-only decision log and `git log` for what actually changed.

---

## Where things stand — 2026-07-15, Phase 2 feature-complete (pending push/CI)

**Phase 1 is done and pushed** (`origin/main`, CI green). **Phase 2 is functionally complete against its own plan checklist** — auth, menu catalog, capability layer (A6/A9), the full console UI with the real design system, and now the two remaining unit tests (money entry, audit log). Every checklist item is met **except the last: "CI green on push"** — the Phase 2 commits are local-only, so CI hasn't run on them yet. Nothing is pushed since Phase 1.

### Phase 2 plan checklist — final status
- [x] typecheck / lint / build clean across the workspace
- [x] New migrations (`0011_catalog`, `0012_menu_capability`) apply cleanly to both local DBs
- [x] A6 + A9 un-skipped and passing; A7/A14 comments corrected to their real phases
- [x] New audit-log + money-entry tests pass (`test/audit/audit.test.ts`, `packages/ui/src/components/money.test.ts`)
- [x] BENCH-01 re-run clean after the A9 `bills` policy change (see `docs/BENCHMARKS-RESULTS.md` "Phase 2 re-run")
- [x] End-to-end walkthrough via real code paths (`scripts/verify-menu-capability.ts`)
- [ ] **CI green on push** — not done; needs a push (ask first, per standing rule)

Beyond the plan, this phase also did a full **design-system pass** (unplanned, requested mid-phase): self-hosted fonts, the app shell, the state rail wired through `/menu`, and Framer Motion with a structural POS/KDS zero-motion guard. See DECISIONS.md.

### What exists and works right now

- **Monorepo**: pnpm + Turborepo. `apps/console` now has real auth (`/login`, session-gated everything else) and a real menu CRUD surface (`/menu`, `/menu/new`, `/menu/[id]`). `apps/{pos,kds,booth,captain}` are still empty shells. `packages/domain`/`ai`/`channels` still empty (Phase 3b+ work).
- **`packages/db`**: full schema through migration `0012`. Has a real build step now (`pnpm build` → `dist/`, `package.json` main/types point there) — needed because Turbopack can't follow the package's NodeNext-style `.js`-suffixed imports the way `tsx` can. `main`/`types` → `dist/`; `scripts/`/`bench/`/`test/` still import source directly, unaffected.
- **Both correctness suites pass**, 40 tests, 2 legitimately skipped (A7, A14 — no code path exists yet to enforce a rule against). **A6 and A9 are no longer skipped** — the role-capability layer is real: a price-change trigger (`can_set_menu_price()` + `check_menu_item_override_price_capability()`) and a restrictive RLS policy on `bills`/`bill_tax_lines`/`payments`.
- **BENCH-01 re-run clean** after the A9 policy change (see `docs/BENCHMARKS-RESULTS.md`'s "Phase 2 re-run" section) — still passes every threshold, InitPlan hoist confirmed intact.
- **Design tokens + 13 UI primitives** (Phase 1's 10 + `Select`/`Textarea`/`MoneyInput` this session) in `packages/ui`.
- **CI is green on `origin/main`** (verified via the GitHub API after a real push, all three jobs passed).

### Local environment, for picking this back up

- **docker-compose Postgres** on port 54329 (`restrobooth`/`restrobooth`) — day-to-day schema dev + the 9M-row bench fixture. Has all migrations through `0012`.
- **Supabase CLI local stack** — `C:\Users\Mohammed\bin\supabase.exe`, direct Postgres on **54322** (`postgres`/`postgres`), API/GoTrue on 54321, Studio on 54323. Start with `supabase start`. This is what the test suites, the console app (`apps/console/.env.local`), and `pnpm seed:auth` all point at.
- **Docker Desktop on this machine is flaky** — its engine has silently dropped mid-session at least twice this project. If `docker ps` fails with a pipe-connection error, just restart Docker Desktop and wait ~20s; the Supabase containers come back on their own (they're not ephemeral).
- **Two seeded accounts for manual login** (`localhost:3000/login`): `owner@restrobooth.test` / `cashier@restrobooth.test`, password `restrobooth` for both. **Re-run `pnpm --filter @restrobooth/db seed:auth` after every `pnpm seed`** — the believable-chain seed truncates `auth.users`, which wipes the repointing; `seed:auth` is idempotent and self-healing (documented in its own header comment).
- **A real, non-obvious gotcha for any future Node CLI script in this package:** the classic `import.meta.url === \`file://${process.argv[1]}\`` entrypoint guard **does not work on Windows** (path-separator/URI-encoding mismatch) — it silently no-ops instead of erroring, which is exactly what happened to `pnpm seed` for an unknown stretch of this project's history. Use `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)` instead. If a future script copies the old pattern, it will look like it ran (exit 0, no error) and do nothing — this is genuinely hard to notice without checking row counts.
- **A real Drizzle gotcha, worth knowing before writing more Server Actions:** `DrizzleQueryError.message` is `"Failed query: <sql>"`, not the underlying Postgres error — that's in `.cause.message`. Any code that pattern-matches on an error message to show a friendlier one (see `apps/console/app/menu/item-actions.ts`'s `fullErrorMessage()`) must walk the `.cause` chain, or the match silently never fires.

### Known gaps — not silently closed, need a human or a follow-up session

1. **No visual review of anything** — `/style-guide` (Phase 1) or the new `/menu` screens (Phase 2). No screenshot/browser tool exists in this environment. Start the dev server and actually look before trusting either isn't template-shaped or visually broken.
2. **The Server Action / real-browser-form flow has not been driven end-to-end.** Verified instead via `packages/db/scripts/verify-menu-capability.ts`, which calls the same `withUser()` primitive the Server Actions use, bypassing Next's request-scoped `cookies()` (which can't be invoked outside a real HTTP request). This proved the full lifecycle (create → options → publish price → resolve_menu reflects it → cashier rejected → cashier 86's → audit trail correct) at the data layer. The literal "open a browser, fill in the form, click submit" path has not been exercised.
3. **A7 (captain can't create a bill) and A14 (QR token replay) are still `test.skip`**, correctly — no bill-creation or token-minting code exists yet (Phase 3a / Phase 5 respectively).
4. **Two BENCH-02 fixture gaps**, documented in `docs/BENCHMARKS-RESULTS.md`: bench overrides don't vary by channel or reference dayparts/promos, so R2/R3 don't fully exercise what their names claim.
5. **No "create category" UI.** Categories exist and `/menu` groups by them, but they're only created by `pnpm --filter @restrobooth/db seed:categories` (a dev script that keyword-buckets the seeded items). A create-category screen is deferred — not in the Phase 2 plan's scope, and the pilot menu can be categorised by the seed for now. New items with no category land in "Uncategorised", which renders fine.

### Local dev fixtures — restore ritual after any test run
The test suite's `globalSetup` truncates and reseeds the believable chain, which drops the GoTrue-linked memberships and the categories. After running `pnpm test`, restore the app's dev state with: `pnpm --filter @restrobooth/db seed:auth && pnpm --filter @restrobooth/db seed:categories`. Both are idempotent. (Docker on this machine also keeps stopping on its own — if the DB is unreachable, restart Docker Desktop, wait ~20s, containers self-recover with data intact.)

### Not yet pushed
All Phase 2 work is committed to `main` locally (`539bbc2` auth · `4a3741e` catalog+capability · `e007687` design system · plus the tests commit). **Nothing pushed since Phase 1.** The only unmet checklist item ("CI green on push") needs this. Ask before pushing, per standing instruction.

---

## Next up: Phase 3a — ordering, tables, KOT

Phase 2 is feature-complete pending the push. Next on the pilot path (ROADMAP.md §2) is **Phase 3a: ordering, tables, KOT** — the first phase that writes `orders`/`order_items`/`kots` for real, and where A7 ("captain can't create a bill") finally gets a code path to enforce against. Re-read ROADMAP.md §2 and DOMAIN.md's state machines at the start of that session.
