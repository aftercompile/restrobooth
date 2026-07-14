# RestroBooth — Progress

Maintained at the end of every session so the next one starts warm. Current state, not history — see [DECISIONS.md](DECISIONS.md) for the append-only decision log and `git log` for what actually changed.

---

## Where things stand — 2026-07-14, mid Phase 2

**Phase 1 is done and pushed** (`origin/main`, CI green — verified via a real GitHub Actions run, not just local checks). **Phase 2 is in progress**, past its second checkpoint (auth slice, then the menu catalog + capability layer). Not yet pushed.

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
5. **Categories are never created by any seed or UI flow yet** — `/menu` groups items by category, but there's no "create category" screen. New items land in "Uncategorised" until one exists. Small, but worth knowing before a demo.

### Not yet pushed

Phase 2's work (auth slice + menu catalog/capability checkpoint) is committed to `main` locally, not yet pushed. Ask before pushing, per standing instruction.

---

## Next up: menu governance UI polish, then Phase 2's remaining acceptance items

Re-read the plan file this session worked from (`docs/ROADMAP.md` §2 + the approved Phase 2 plan) before continuing. Remaining before Phase 2 can be called done: a "create category" flow, and a final walkthrough against the plan's own verification checklist (the 21-row precedence table already passes from Phase 1; what's new here is confirming the UI actually surfaces it correctly end-to-end).
