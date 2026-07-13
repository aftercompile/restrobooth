# ADR-0007 — AI provider abstraction, budget, cache, and degradation

**Status:** Accepted
**Date:** 2026-07-13

## Context

The AI layer is the product thesis — it is why RestroBooth beats PetPooja rather than merely matching it. It is also the part most likely to be slow, expensive, non-deterministic, or down. It sits in front of a guest who will abandon in 8 seconds.

The governing principle, from the brief, and it is the right one:

> **Deterministic math first, LLM for language and judgment.** Anything countable — co-occurrence, margin, forecast baseline, sentiment counts — is computed in **SQL**. The LLM explains, ranks, and writes. This keeps it fast, cheap, testable, and honest.

## Decision

### 1. A provider interface, in `packages/ai`. No vendor is hard-coded.

```ts
interface AIProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>
  embed(texts: string[]): Promise<number[][]>
  readonly id: string
  readonly costPer1kTokens: { input: number; output: number }
}
```

Primary: **Anthropic Claude** — **Haiku 4.5** for high-volume guest-facing calls (the Booth Host reason strings, upsell one-liners), **Sonnet 5** for analysis (menu engineering, review extraction, Ask RestroBooth). A dev-time free/mock provider is swappable in via config, and the test suite runs against a **deterministic stub provider** so AI-adjacent tests are not flaky and cost nothing.

Model IDs are configuration, not code. They change.

### 2. Embeddings are free and local

`gte-small` (384 dims) via a Supabase Edge Function → `pgvector`. **No external key, no per-call cost, no vendor.** Item embeddings are built from `description + tags + review aspects` and refreshed on publish. The Booth Host's shortlist comes from **vector similarity + rules**, computed in Postgres — the LLM never picks the dishes, it only writes the reason copy.

This is the single most important structural decision in the AI layer: **the recommendation is deterministic and testable; only the prose is generated.** It is what makes recommendation quality measurable instead of vibes, and it is what keeps the Booth fast.

### 3. Graceful degradation is a hard requirement, not a nice-to-have

> **If the model is down, slow, or over budget, the product still works — the AI rail just doesn't render.**

Enforced structurally:

- **The menu never waits on AI.** The Booth paints the menu immediately; the "Picked for you" rail slides in *if and when* it resolves. There is no spinner blocking the menu, ever.
- Every AI call has a **hard timeout** (Booth: **1200 ms**; console analysis: 30 s). On timeout, the caller gets `null` and renders nothing. **No error toast on the guest surface** — the guest never learns that a feature exists and failed.
- **Every AI surface has a deterministic fallback**, and the fallback is what the guest sees if AI is off:
  - Booth Host → rules-only ranking (diet filter + tags + popularity). Still useful. Still personal-ish.
  - Upsell → SQL market-basket lift, with a generic label ("Often ordered together"). The *numbers* were never AI.
  - Menu engineering → the BCG matrix from SQL, without the narrative.
  - Ask RestroBooth → **disabled entirely**, because it has no non-LLM fallback. It is the only feature that hard-depends on the model, and that is stated on the tin.
- **Phase 6 gate demo: turn the AI provider off and demonstrate every surface still works.** This is an acceptance criterion, not an aspiration.

### 4. Budget guard, per outlet

A per-outlet monthly token budget, enforced **server-side before the call is made**, not after. At 80% → warn in console. At 100% → the AI rail stops rendering; the product carries on exactly as in the degradation path above. **An outlet cannot generate an unbounded bill.**

### 5. Response cache, keyed on a content hash

- Booth Host → cache on `hash(preference_vector, store_id, menu_version)`. Two guests with the same stated preferences at the same restaurant get the same (cached, free, instant) recommendations. **In practice the intake has ~4 low-cardinality dimensions, so the hit rate should be very high** — this is what makes a per-guest LLM feature affordable at all.
- Upsell → cache on `hash(cart_items, store_id, menu_version)`.
- Content Studio / analysis → cache on `hash(inputs)`.
- **`menu_version` in the key is what makes invalidation correct**: publish a menu change and every cached recommendation for that store is invalidated automatically. No manual cache-busting.

### 6. The AI never touches the ledger

Restated because it is the most important rule in this document and it is a structural boundary, not a guideline:

**No AI-produced value is ever written to `bills`, `payments`, `order_items`, `stock_ledger`, or any tax field.** `packages/ai` has **no write access** to those tables — enforced by using a distinct database role for AI-layer queries that has `SELECT` only, on an allowlisted view layer. The AI can *recommend* a price; a human publishes it through the governed flow ([TENANCY.md](../TENANCY.md) §7.5).

### 7. Ask RestroBooth (text-to-SQL) — the guardrails

The one genuinely dangerous feature. Non-negotiable:

- Queries run as a **read-only role** against an **allowlisted view layer**, never against raw tables.
- `outlet_id` scoping is **injected server-side** into every query, not requested from the model. **The model never sees, and never controls, which outlets a user may read.**
- Hard **statement timeout** (5 s) and **row cap** (10 000).
- **No DDL, no DML** — the role cannot execute them, so a prompt injection cannot either.
- Every generated query is **logged with its prompt** for audit.

The guardrails are enforced by database permissions, not by prompt engineering. **A prompt is not a security boundary.**

## Consequences

- **Positive:** the product survives the AI being down, over budget, or removed. Degradation is designed, not discovered.
- **Positive:** provider-swappable; embeddings cost nothing; the cache makes per-guest AI affordable.
- **Positive:** recommendation quality is *measurable* — the shortlist is deterministic, so the Phase 6 eval harness can assert on it.
- **Negative:** two code paths (AI and fallback) on every AI surface. That is the price of the requirement, and the fallback path is the one that must never break — **so the fallback is the default in tests, and the AI path is the special case.**
- **Negative:** cache invalidation on `menu_version` means a menu publish invalidates every cached recommendation for that store — a cold cache right after a menu change. Acceptable; menu publishes are rare and the first few guests simply pay the latency.
