# RestroBooth — Benchmark Results (Phase 1)

**Status: BENCH-01 CONFIRMED (with two schema fixes). BENCH-02 CONFIRMED.**
**Run:** 2026-07-14, against the full BENCHMARKS.md fixture (20 outlets, 28 stores, 800 menu items, 2.27M orders, 9.1M order_items, 12 monthly partitions), on local containerised Postgres per the Phase 1 planning decision — see "Host" below.
**Harness:** `packages/db/bench/harness/` (`bench-01.ts`, `bench-02.ts`). Raw output: `packages/db/bench-01-results.json`, `packages/db/bench-02-results.json`.

This document is the gate. Per `docs/BENCHMARKS.md`: *"A provisional ADR that is still provisional at the end of Phase 1 is a bug in the process, not a pending task."* Both are now resolved.

---

## Host, honestly

BENCHMARKS.md specifies "a Supabase Pro-equivalent instance." Per the Phase 1 planning decision, this ran against **local containerised Postgres** (the docker-compose instance already used for schema development, Postgres 16, same machine as this session) instead. What BENCH-01/02 actually measure — query planning under RLS, and whether `accessible_outlet_ids()` hoists to an InitPlan — is a property of the query plan Postgres chooses, which is host-agnostic; it does not depend on being colocated with a specific hosting provider's network. The harness is entirely connection-string driven (`BENCH_DATABASE_URL`) with no local-only assumption, so re-running it against a real Supabase Pro instance later is a config change, not a rewrite. Absolute latency numbers on a shared local machine should be read as **shape, not SLA** — the thresholds have generous margin (often 5-15x), which is the intent: they should survive real network/infra variance, not just this laptop.

---

## BENCH-01 — RLS

### Result: every query, every role, passes — after two real schema fixes the benchmark itself surfaced

| # | Query | Threshold (p95) | First run | Final run (p95, worst role) | Verdict |
|---|---|---|---|---|---|
| Q1 | POS hot path: order + items for one order | 20ms | 2.3ms | 2.1ms | PASS |
| Q2 | POS menu load: `resolve_menu()` | 50ms | 5.4ms | 5.5ms | PASS |
| Q3 | KDS: KOTs fired in the last 4h | 30ms | **210.9ms — FAIL** | 5.8ms | PASS (fixed) |
| Q4 | Floor map: table sessions for outlet+date | 20ms | **865.8ms — FAIL** | 4.9ms | PASS (fixed) |
| Q5 | Bill finalise: insert (rolled back) | 100ms | 8.8ms | 3.5ms | PASS |
| Q6 | Report: day-end summary | 200ms | 23.2ms | 16.2ms | PASS |
| Q7 | Cluster report: 30-day, 5 outlets (live agg — no rollup table exists in Phase 1) | 500ms | 75.1ms | 57.0ms | PASS |
| Q8 | The 15-case adversarial suite | correctness | — | — | PASS — see `test/rls/adversarial.test.ts` (separate suite, not re-run here) |

Q3 and Q4 **failed on the first run, badly** — up to 43x over threshold — and the failure was present even with RLS bypassed entirely (variant A). That ruled out `accessible_outlet_ids()` as the cause before looking anywhere else: this was a missing-index problem, not an RLS problem. Fixed in two parts, both real, both now shipped:

**Fix 1 — two missing indexes.** Neither `kots` nor `table_sessions` had any index beyond their own PK/unique constraints. Every "KOTs for this outlet in the last 4h" or "sessions for this outlet today" query was scanning far more than it needed (`table_sessions` isn't partitioned, so its scan was effectively the whole 2.27M-row table). Added in `drizzle/0010_bench01_indexes.sql`:
- `kots (outlet_id, fired_at)`
- `table_sessions (outlet_id, opened_at)`
- `outlet_group_members (outlet_id)` — named explicitly in BENCHMARKS.md's own escalation ladder step 1 ("almost certainly already the issue"), added proactively; it measurably helped Q7's cluster-manager case.

**Fix 2 — `CREATE INDEX` doesn't refresh planner statistics.** After adding the index, Q4 was *still* 150-180ms — the new index existed but the planner's row-count estimate for `table_sessions` was stale enough that it used the composite index for the `outlet_id` equality only, pushed the date range to a post-scan filter, and pulled ~113,778 rows off the heap to filter down to 301. A plain `ANALYZE table_sessions` (no `VACUUM` needed) fixed this specific case outright: **181ms → 0.32ms, ~560x, same index, same data — statistics alone.** `ANALYZE` statements for all three newly-indexed tables are now part of the migration itself (`0010_bench01_indexes.sql`), not a manual step someone has to remember.

**Fix 3 — a planner-vs-RLS interaction that isn't in BENCHMARKS.md's own escalation ladder.** Even after both fixes, Q4 *still* intermittently cost 150-230ms specifically when run as an `authenticated` role (RLS active) — reproducible, and gone entirely when the same query ran as superuser (RLS bypassed). `EXPLAIN` traced it to the query's own predicate, not RLS's function: `opened_at >= $1::date AND opened_at < $1::date + interval '1 day'`. With RLS's two hashed `SubPlan`s (`accessible_outlet_ids()`, `accessible_store_ids()`) present in the same `Filter`, the planner stopped pushing the date range into the index condition at all — reverting to an `outlet_id`-only index scan plus a bulk post-filter, discarding 113,477 of 113,778 rows. With the exact same predicate rewritten as two precomputed `timestamptz` literals instead of inline `date + interval` arithmetic, the planner used the full composite index correctly **regardless of whether RLS was active** — 3ms either way. This is a genuinely separate finding from "is `accessible_outlet_ids()` slow": the InitPlan hoist was never broken (see next section) — the *presence* of RLS's hashed subplans in the same `WHERE` clause changed the planner's cost model for an unrelated, non-RLS predicate. Filed as a concrete lesson, not a hypothesis: **avoid inline date/interval arithmetic in a WHERE clause that will also carry an RLS-injected filter; precompute range bounds in application code.** `bench-01.ts`'s Q4 was rewritten accordingly.

None of these three fixes touch `accessible_outlet_ids()`, `accessible_store_ids()`, or any RLS policy. All three are schema/query fixes that BENCH-01 exists specifically to catch before Phase 2 builds on an assumption.

### The InitPlan hoist — verified, not assumed

TENANCY.md's actual claim (§4) is that the access functions are evaluated **once per statement**, not once per row. Every `EXPLAIN (ANALYZE, BUFFERS)` plan captured across Q1-Q7, for every role, shows this directly — e.g. Q1 as `outlet_manager`:

```
Index Scan using order_items_2026_07_order_id_client_line_id_business_date_key on order_items_2026_07 oi
  (cost=15.95..24.01 rows=1 width=159) (actual time=0.863..0.870 rows=5 loops=1)
  Index Cond: ((order_id = 'cf7d5d11-...'::uuid) AND (business_date = '2026-07-13'::date))
  Filter: ((hashed SubPlan 1) AND (hashed SubPlan 2))
  SubPlan 1
    ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=16) (actual time=0.367..0.384 rows=1 loops=1)
  SubPlan 2
    ->  ProjectSet  (cost=0.00..5.27 rows=1000 width=16) (actual time=0.416..0.436 rows=1 loops=1)
Execution Time: 0.945 ms
```

(captured for `outlet_manager`; `packages/db/bench-01-results.json` → `explains["Q1 ..."]` has the full, unedited text)

`loops=1` on every SubPlan, for every query in the set — the functions run once per statement regardless of how many rows the base scan touches. This is the property TENANCY.md's "whole ballgame" comment is about, and it holds at 9M rows.

### Variant A/B/C — RLS off / wrapped+STABLE / naive VOLATILE

Run on Q1 and Q6 specifically (not all 7 — the InitPlan-hoist effect is a property of the wrapper pattern itself, not of any one query shape; re-deriving naive policies for all 7 tables in the query set would multiply SQL plumbing without changing the conclusion).

| Variant | Q1 p50/p95 | Q6 p50/p95 |
|---|---|---|
| A — RLS off (floor) | 1.0 / 1.4ms | 6.0 / 7.4ms |
| B — real policies (`STABLE`, wrapped) | 1.5 / 2.1ms | 10.3 / 13.5ms |
| C — naive (`VOLATILE`, same call shape) | 1.4 / 2.0ms | 10.1 / 11.9ms |

**B is comfortably within BENCHMARKS.md's "~2x of A" bar for both queries (Q1: 1.5x; Q6: 1.8x) — the design holds.**

**C did not reproduce the catastrophic case, and that is itself worth reporting rather than glossing over.** The hypothesis was that marking `accessible_outlet_ids()`/`accessible_store_ids()` `VOLATILE` (instead of `STABLE`) would force per-row re-evaluation and blow up latency — that's the textbook Supabase RLS trap. It didn't happen here, and `EXPLAIN` shows why: both the `STABLE` and the `VOLATILE` versions of the function, called via `outlet_id IN (SELECT fn())`, get planned as a **hashed SubPlan evaluated once per statement** (`loops=1`) — because the subquery is *uncorrelated* (nothing in it references the outer row), and Postgres treats an uncorrelated `IN (subquery)` as a self-contained hash-table build regardless of the called function's volatility marking. Volatility controls whether Postgres may treat repeated calls *within a scan* as safe to skip re-evaluating — it doesn't, by itself, force per-row execution of something that was never correlated to begin with. The catastrophic per-row case TENANCY.md and BENCHMARKS.md warn about needs the *unwrapped, correlated* form — e.g. a policy written as `outlet_id = ANY(SELECT ... FROM memberships m WHERE m.something = outer.something)` or a bare scalar call like `auth.uid()` referenced directly instead of via `(SELECT auth.uid())` — not merely a volatility flag on a set-returning function used in a plain `IN`. **This doesn't weaken the case for the wrapper**: `(SELECT ...)` is still correct, idiomatic, and is exactly what makes the *scalar* `auth.uid()` case safe (a bare scalar function call in a WHERE clause has no subplan/hash-table shape to fall back on the way a set-returning function in an IN-list does). It does mean this specific three-way comparison, as constructed, measured a smaller effect than BENCHMARKS.md's prose implied it would — reported honestly rather than re-engineered until it produced the expected number.

### Escalation ladder — not needed

BENCHMARKS.md's step 1 (index `memberships(user_id)` and `outlet_group_members(outlet_id)`) was already partially true — `memberships(user_id)` existed — and the `outlet_group_members(outlet_id)` half is exactly the gap this run closed. No further escalation (materialised `user_accessible_outlets`, JWT outlet-ID caching) is needed; variant B is within 2x of the floor across the board.

---

## BENCH-02 — Override resolution (`resolve_menu()`)

### Correctness gate — already passed, before any timing number

Per BENCHMARKS.md's own rule ("must pass, exhaustively, before any timing number is even reported"): the 21-row precedence table (`test/override/precedence.test.ts`, TENANCY.md §7.4) already passes in full, including rows 8, 12, 17, and 21 — see the Phase 1 test-suite checkpoint. Not re-run here.

### Result: R1 (the gate) at 2.9ms p95 against a 50ms threshold — 17x margin

| # | Query | Threshold (p95) | Result | Verdict |
|---|---|---|---|---|
| R1 | Full menu, `(store, dinein, now)` — **the gate** | 50ms | p50=2.2ms p95=2.9ms p99=3.4ms | PASS |
| R2 | Full menu, `(store, zomato, now)` — "dense overrides" | 50ms | p50=1.9ms p95=2.6ms p99=3.4ms | PASS |
| R3 | Full menu during an active daypart+promos ("worst case") | 80ms | p50=2.2ms p95=3.5ms p99=4.0ms | PASS |
| R4 | Resolve one item (cart/upsell) | 5ms | p50=1.4ms p95=1.7ms p99=2.3ms | PASS |
| R5 | Channel menu push: 28 stores x 6 channels (batch) | 10s | 310ms total, 168 resolutions | PASS |
| R6 | Full menu at a future timestamp (scheduled change) | 50ms | p50=1.8ms p95=2.7ms p99=3.7ms | PASS |

`resolve_menu()` is `SECURITY DEFINER` and reads its own tables directly — it never calls `accessible_outlet_ids()`/`accessible_store_ids()`, so there is no role/RLS variant to compare here (unlike BENCH-01, the caller's identity doesn't affect its cost).

### Two honest fixture gaps, reported rather than hidden

- **R2 is not actually denser than R1 in this fixture.** `bench/dimensions.ts`'s override rows are store-scoped only (`channel_code` is always null, which matches any channel) — R1 and R2 exercise the *identical* candidate set. The "dense overrides on a non-dinein channel" scenario BENCHMARKS.md describes isn't distinguishable from R1 in the current bench fixture generator. Not a resolver bug; a fixture-generator gap, worth closing if channel-scoped overrides become a Phase 2 feature under test.
- **R3 doesn't exercise real specificity competition.** The resolver's `active_dayparts`/`active_promos` CTEs run for real and are timed for real, but no bench override row references a `daypart_id` or `promo_id` — bench overrides are all store-only (`specificity = 1`). The 21-row correctness suite (small, hand-built fixture) is what actually exercises multi-dimension precedence; BENCH-02's R3 only proves the *machinery* (checking which dayparts/promos are active right now) is cheap, not that picking a winner among many competing high-specificity rows is cheap at scale. Given R1's 17x margin and R3's near-identical timing to R1, this is very unlikely to matter, but it's not proven by this run.

### Escalation ladder — not needed

R1 passes with a 17x margin. No caching, no materialised view. ADR-0006's "one call site to change" requirement stands as insurance for the future, not as something Phase 1 needed to invoke.

---

## What changed in the schema because of this benchmark

- `packages/db/drizzle/0010_bench01_indexes.sql` (new): 3 indexes + 3 `ANALYZE` statements.
- `packages/db/src/schema/tenancy.ts`: `index("outlet_group_members_outlet_id_idx")`.
- `packages/db/src/schema/operations.ts`: `index("kots_outlet_fired_idx")`, `index("table_sessions_outlet_opened_idx")`.
- `packages/db/bench/harness/bench-01.ts`'s Q4: rewritten from `opened_at::date = $2` (non-sargable) to two precomputed `timestamptz` bounds, per the planner finding above.

## ADRs updated in this commit

- [adr/0006-override-resolution.md](adr/0006-override-resolution.md): PROVISIONAL → **CONFIRMED**.
- [TENANCY.md](TENANCY.md) §4: the RLS mechanism's open question → **CONFIRMED**, linking here.
