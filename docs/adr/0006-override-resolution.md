# ADR-0006 — Menu override resolution: live vs. materialised

**Status:** **PROVISIONAL** — decision stands pending **BENCH-02**
**Date:** 2026-07-13

## Context

The brief (§10.2) asks: *"materialised view refreshed on publish, or resolved live on every read? (Live is correct until it isn't. Benchmark it against 20 outlets × 200 items × 6 channels before deciding.)"*

The resolver ([TENANCY.md](../TENANCY.md) §7.3) takes `(store, channel, timestamp)` and returns each item's effective price and availability by picking the highest-specificity published override row that matches. Read volume is high: every POS menu load, every Booth QR scan, every KDS render, every channel menu push.

Worst case: 20 outlets × 200 items × 6 channels = **24 000 resolved cells**, times daypart and promo variation.

## Decision

**Live resolution, in a single SQL function. Provisionally — the decision is conditional on BENCH-02 and will be revisited with real numbers in Phase 1, before Phase 2 builds on it.**

### Why live, on the merits

1. **Effective-dated pricing falls out for free, and that is a bigger deal than it looks.** A price scheduled for Monday 00:00 is simply a published row whose `effective_from` is Monday. The resolver is time-aware, so **the change fires with no cron job and no refresh worker.** With a materialised view, a scheduled price change depends on a background job running on time — and if that job is down at midnight on Monday, **every outlet sells at the wrong price and nobody finds out until the day-end report.** That is a strictly worse failure mode than a slow query, and it is the single strongest argument here.

2. **86'ing must propagate in *real time*** to POS, KDS, Booth, and every channel listing (brief §Phase 2 demo). A materialised view means an 86 is not real until a refresh completes. Live resolution means an 86 is real the moment it commits.

3. **A materialised view of this is enormous and mostly empty.** Materialising `(item × store × channel × daypart × active promos)` is a combinatorial explosion of rows that are, overwhelmingly, just the brand default. **Sparse overrides exist precisely so we don't store that.** Materialising it un-does the entire point of the sparse design.

4. **Correctness first.** "Live is correct until it isn't" — so start correct, and prove we need to compromise before compromising.

### Why it might not survive

The resolver runs on every menu read, and the Booth's LCP budget is **2 s on 4G**. If resolving 200 items takes 400 ms, that is a meaningful chunk of the budget spent in Postgres. The risk is real and it is why this ADR is provisional.

## BENCH-02 — the gate

Specified in full in [BENCHMARKS.md](../BENCHMARKS.md). Summary:

- Dataset: 20 outlets, 2 brands, 200 items/brand, 6 channels, 4 dayparts, 10 active promos, and a **realistically sparse** override set (~15% of cells overridden — an unrealistically dense set would unfairly favour materialisation).
- Query: resolve a full 200-item menu for `(store, channel, now)`.
- **Pass: p95 < 50 ms.** Fail → escalate.

## The escalation ladder — in order, cheapest first

We do **not** jump straight to a materialised view if BENCH-02 fails. In order:

1. **Index and rewrite.** A partial index on `(menu_item_id, status, specificity desc) where status='published'` and a `distinct on` formulation. Most likely sufficient; costs nothing.
2. **Cache the resolved menu in the application**, keyed on `(store, channel, daypart, promo_set_hash)`, invalidated by a Postgres `NOTIFY` on publish/86. Keeps the DB as the source of truth, keeps effective-dating correct (the cache key includes the daypart), and gets us a ~5 ms hot read. **This is the most likely landing spot** and it preserves every advantage of live resolution.
3. **Materialise per-store, refreshed on publish** — only if 1 and 2 both fail. If we get here, we must *also* build the cron-refresh reliability that live resolution gave us for free, including an alarm for "a scheduled price change did not fire," and that is a real, ongoing cost. **Do not pretend it is free.**

## Consequences

- **Positive:** effective-dated pricing and instant 86 both work with no background worker, and cannot fail because a worker was down.
- **Positive:** the sparse-override design is preserved end to end.
- **Negative:** the resolver is on the hot path of the most latency-sensitive read in the product (the Booth menu). It must be fast, and we do not yet know that it is.
- **Negative:** the decision is provisional, so Phase 2 must not hard-code an assumption that resolution is free. **Requirement: all menu reads go through one function** (`resolveMenu()` in `packages/db`), so that swapping live → cached → materialised is a change in *one place* and not a refactor of every surface.

That last point is the real deliverable of this ADR. **Whatever BENCH-02 says, there is exactly one call site to change.**
