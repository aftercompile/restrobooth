# RestroBooth — Disagreements & Open Decisions

**Status:** Phase 0 deliverable. **Read this one first.**
**Last updated:** 2026-07-13

The brief's standing rule §9.10 says: *"Flag it when I'm wrong. I'd rather argue at Phase 0 than at Phase 8."* Taking that at its word.

---

# Part 1 — My top three disagreements

## Disagreement 1 — Ten phases is not a plan, it is a way to never ship

**The brief says:** ten phases, pilot at Phase 5, chain features at Phase 8+.

**My disagreement:** the brief already contains the correct diagnosis — *"Model the irreversible things now. Sequence the features so a single real restaurant can pilot by the end of Phase 5"* — and then lays out a ten-phase plan in which **more than half the work happens after the pilot**, with no structural mechanism to stop that work from starting early.

The honest failure mode, and by far the most likely way this project dies: **the chain features are the fun ones.** Central kitchen, franchise royalty, inter-GSTIN transfer, network benchmarking — these are genuinely interesting engineering. Billing a table of four correctly at 9 PM with the WiFi down is not interesting. It is fiddly, unglamorous, and it is **the entire product.** A plan that lists both without a hard gate between them will drift toward the fun ones, and it will feel productive the whole way.

**What I want instead:** the same phases, plus **one hard gate that is not negotiable** —

> **Phase 8 does not begin until a real restaurant has run a real service on RestroBooth. Not a demo. A service, with real guests and real money.**

And a test to apply at every phase review: **would the pilot restaurant notice this feature's absence?** If no, it is not v1. I have written this into [ROADMAP.md](ROADMAP.md) §2 and [RISKS.md](RISKS.md) R1 as the plan of record. **This is the disagreement I care most about**, and it is the one you can most easily overrule by simply not enforcing it — which is exactly why I want it agreed now, in writing, while it costs nothing.

---

## Disagreement 2 — The override chain keys on the wrong entity, and the brief's own model says so

**The brief says (§3.1):** `brand default → outlet override → channel override → daypart → promo`.

**My disagreement:** the second link must key on **`store`, not `outlet`.**

The brief itself establishes that *"menus, channel listings, and orders attach to **store**"* — and then, three paragraphs later, describes the price override chain as keying on outlet. **These cannot both be right.** A menu item belongs to a brand; an override row keyed on `outlet_id` can express a meaningless state (*"item X of brand B1 is ₹250 at outlet AMD-1"* — when B1 doesn't sell at AMD-1), and it is **ambiguous in exactly the case the brief invented the store entity to solve**: the cloud kitchen where four brands share one outlet. Which brand's price did you just override?

`store` *is* `(brand, outlet)`. It is identical to `outlet` in the single-brand case, and it is the only correct key in the multi-brand case. **This is a consistency fix that makes the brief agree with itself**, not a change of direction — but it is load-bearing and it would have been very expensive to find in Phase 8. Written up in [TENANCY.md](TENANCY.md) §7.1.

**Also, and separately:** the precedence chain needs **binary specificity weights** (promo 8, daypart 4, channel 2, store 1) rather than an ordered list, because an ordered list does not tell you what to do when a *promo* competes with a *store+channel+daypart* override. Binary weights make precedence a provable total order over all 16 combinations, with no ties possible. The exhaustive 21-row test table is in [TENANCY.md](TENANCY.md) §7.4.

---

## Disagreement 3 — "Free tier throughout" is not achievable, and the deadline is earlier than you think

**The brief says:** free tier throughout; Vercel Hobby is *"fine for dev, not for a paying restaurant."*

**My disagreement:** that framing understates the problem by about three phases.

**Verified against live docs (2026-07-13):** Vercel's fair-use guidelines define commercial usage as including *"any method of requesting or processing payment from visitors of the site"* — and it explicitly extends to *"financial gain of **anyone** involved in **any part of the production** of the project, including a paid employee or consultant writing the code."*

**The Booth's pay-at-table feature is, by that definition, commercial use.** Not when we get a paying restaurant — **the moment a guest pays through the Booth in Phase 5.** Donations count. A paid consultant writing the code counts.

Supabase Free is worse: **500 MB** total database, and our own row arithmetic ([ERD.md](ERD.md) §6) says 20 outlets generate ~48M rows/year. Free is exceeded by **one busy outlet inside a year.** Add project-pausing after a week of inactivity, and a 200-concurrent-Realtime-connection cap that a single Saturday-night outlet can approach on its own.

**What I want instead:** stop calling free tier a deployment target. It is a **development environment**, and that is fine — the real number is **~$45/month** (Supabase Pro $25 + Vercel Pro $20/seat), which is not a business risk, it is a rounding error. **The risk is not the cost. The risk is discovering the constraint mid-pilot.** So: name the trigger now (Phase 5), and enforce the escape-hatch rule that keeps it cheap — *no Supabase- or Vercel-specific API may be called from `packages/domain` or from any UI component.* [ADR-0001](adr/0001-hosting.md).

---

### Honourable mention — a thing the brief gets *right* that I'd have argued with

The brief insists `packages/domain` be pure, dependency-free, and 100% tested. That reads like architecture-astronaut dogma until you notice what it buys: **the same money math runs on the offline terminal and on the server and produces the same paise.** That is what makes offline-first billing tractable rather than terrifying, and I don't think the brief fully spells out that this is the *reason*. It is the best decision in the document. Do not let anyone dilute it.

---

# Part 2 — The eight open decisions (§10)

## §10.1 — Does the store/outlet split survive contact with reality?

**Recommendation: yes, with one new rule and one accepted gap.** Full stress test in [TENANCY.md](TENANCY.md) §2.

| Case | Verdict |
|---|---|
| **Cloud kitchen, 4 brands, 1 kitchen** | ✅ 1 outlet, 4 stores. This is precisely what the split is *for*. Unmodellable without it. |
| **Food-court stall** | ✅ Fits trivially — **but it exposes a real gap I am declaring out of scope on purpose.** There is no `Venue`/`Landlord` entity, so a food court where the *mall* runs the cashier and takes a revenue share is not a RestroBooth customer in v1. A stall that bills its own guests is fine. Additive to fix later, not a rewrite. |
| **One brand, two floors** | ⚠️ **Genuinely ambiguous, and the brief gives no rule. So here is one.** |

**The new rule — the outlet boundary is the operational boundary:**

> **An Outlet is the smallest unit with its own inventory pool AND its own kitchen (KOT printer set). Share both → one outlet, two areas. Have your own of either → two outlets.**

Two floors, one kitchen, one store-room, two tills → **one outlet, two areas, two terminals.** (A cash drawer belongs to a *terminal*, not an outlet — so two tills is not evidence of two outlets.) Ground-floor restaurant + rooftop bar with its own bar-kitchen and its own liquor stock → **two outlets**, possibly sharing a brand and a GSTIN.

**If that rule breaks against a real venue you have in mind, I need to know now.** It is the one piece of the tenancy model I invented rather than derived.

---

## §10.2 — Override resolution: live or materialised?

**Recommendation: live resolution — PROVISIONAL, pending BENCH-02.** [ADR-0006](adr/0006-override-resolution.md).

The argument is not primarily about speed. **It is that a materialised view makes effective-dated pricing depend on a cron job.** A price change scheduled for Monday 00:00 becomes a background refresh that must run on time — and **if that worker is down at midnight, every outlet sells at the wrong price and nobody finds out until the day-end report.** With live resolution, the resolver is time-aware and the scheduled change simply *is* true at 00:00, with no worker involved. That is a strictly better failure mode than a slow query. Same argument for 86'ing: live means an 86 is real the instant it commits.

Also: materialising `(item × store × channel × daypart × promo)` is a combinatorial explosion of rows that are overwhelmingly just the brand default. **Sparse overrides exist precisely so we don't store that.** Materialising undoes the whole design.

**Escalation if BENCH-02 fails, cheapest first — we do not jump to a materialised view:** (1) index + rewrite; (2) **application cache keyed on `(store, channel, daypart, promo_hash, menu_version)`, invalidated by `NOTIFY`** — most likely landing spot, and it keeps every advantage of live; (3) materialised view, and only then, and we must budget for the refresh-reliability infrastructure it forces on us.

**The real deliverable of that ADR:** all menu reads go through **one function**, so whatever the benchmark says, there is exactly one call site to change.

---

## §10.3 — Offline conflict rule: LWW or server-rejects-with-replay?

**Recommendation: neither, globally. It is per entity, and a single global rule is guaranteed to be wrong.** Full table in [DOMAIN.md](DOMAIN.md) §8 — this is a **gate item**.

The proof that no global rule works, in two lines:

- **`order_items` must merge.** Captain A adds two naan offline; Captain B adds a dessert online. Under last-write-wins, **one of them vanishes and a guest doesn't get food.** Never LWW.
- **`table_session` close must reject-and-replay.** Under LWW, a stale offline `close` resurrects or re-closes a table — **which is literally the bug in the brief's own opening paragraph: "a table that shows occupied after the guests left."**

They want opposite things. Any single policy gets one of them wrong.

The governing principles that generate the rest of the table: **never lose an order** (it outranks tidiness) · **never duplicate money** (a duplicate bill is worse than a rejected one) · **prefer under-selling to over-selling** (if two people disagree about stock, believe the pessimist) · **every mutation carries a client-generated idempotency key** (replay is always safe).

Headlines: `order_item` → append-only merge. `table_session` **open** → auto-merge (rejecting loses orders). `table_session` **close** → server rejects. `bill` → immutable, dedup on key, **never renumbered**; a genuine duplicate **flags for a manager and is never auto-resolved** — money is not a thing you silently merge. `payment` → at-most-once. `86` → LWW but **asymmetric**: `unavailable` beats `available`. Menu/prices → **read-only on terminals**, so no conflict is possible by construction.

---

## §10.4 — Offline bill numbering, exhaustion, and gaps

**Recommendation: reserved contiguous blocks, a per-terminal offline fallback *series*, and gaps that are permanent and explained.** [DOMAIN.md](DOMAIN.md) §6.

The legal frame first, because it constrains the design more than people expect. **CGST Rule 46(b): the invoice number is ≤ 16 characters, alphanumeric plus `-` and `/`, unique for a financial year (Apr–Mar), consecutive — and may run in one *or multiple* series.**

- **16 characters is a hard ceiling** and it constrains the format. `A1/2627/000123` is 14. It goes in a `check` constraint.
- **Multiple series are explicitly permitted — and that is the escape hatch that makes offline billing legal.**

**Blocks:** each terminal holds a contiguous reserved range, allocated server-side under an **`exclude using gist` constraint that makes overlapping blocks impossible at the database level** ([ERD.md](ERD.md) §5). Two terminals cannot be issued the same number even if the application code is wrong. Block size = 3× the terminal's p95 daily bills (default 300). **Low-watermark auto-top-up at 30% remaining, while still online** — which is what makes exhaustion almost impossible in practice.

**Exhaustion while offline:** fall back to the terminal's **dedicated offline series** (pre-allocated at provisioning, no server round-trip). Legal, because multiple series are permitted.

**What we never do:** refuse to bill; or print a provisional number and renumber it on sync. **A printed invoice number is immutable the instant it leaves the building — the guest is holding it.** Renumbering on sync is the most tempting and most illegal shortcut available here.

**Gaps:** permitted, permanent, **never reused**, and every one of them is written to an `invoice_number_gap` register with a reason. Reusing 138–200 risks a collision when a terminal comes back online holding an unsynced bill numbered 139. **Correctness beats tidiness.** The Gap Register is a Phase 9 report, and it exists so that the answer to the auditor's question is a printout.

---

## §10.5 — RLS performance: does the `SECURITY DEFINER` lookup hold?

**Recommendation: it holds *if and only if* the function is `STABLE` and the call is wrapped in `(select …)` — and we benchmark it rather than believing me.** **BENCH-01**, [BENCHMARKS.md](BENCHMARKS.md).

The crux is narrower than the question implies. The wrapper is what makes Postgres evaluate the function **once per statement as an InitPlan** instead of **once per row.** Without it, a scan of a 9M-row partition calls it **nine million times.** That is the difference between 40 ms and a timeout, and it is the single most common way a Supabase RLS deployment falls over. It is a two-character fix that nobody notices is missing.

BENCH-01 therefore runs the suite **three ways** — RLS off (the floor), RLS on with the wrapper, and RLS on naive — because **demonstrating that the naive form is catastrophic is itself a deliverable.** It is what stops someone "simplifying" the wrapper away in six months.

**Escalation if it fails:** (1) index `memberships(user_id)`; (2) **verify the InitPlan hoist actually happened** — everything downstream is meaningless if it didn't; (3) **materialise `user_accessible_outlets` as a real table maintained by trigger** — most likely landing spot; (4) **JWT-cached outlet IDs — last, not first.**

**Why JWT caching is last, and this is the part worth arguing about:** a JWT is valid until it expires. **Revoking a membership does not revoke an outstanding token.** A fired manager keeps access until their JWT expires. The mitigations (short TTL, a token-version claim checked against the DB) claw back most of the performance win — so the "fast" option is substantially less fast than it looks, *and* it trades away a security property. It is a real option and I would take it if the benchmark forces me, but it should be the last resort, not the reflex.

---

## §10.6 — Data retention: the hot window and the cold tier

**Recommendation: monthly partitions on `business_date`, a short hot window, and — the load-bearing idea — rollups materialised at Day Close.** [ADR-0002](adr/0002-data-retention.md).

Hot windows are set **by value, not by volume**: `order_status_events` 1 month (22M rows/year, genuinely disposable); `orders`/`order_items`/`kots` 3 months; **`bills`/`payments`/tax lines 13 months** (a full FY plus overlap, so a March audit never touches cold storage); **audit tables forever, never partitioned.**

**The idea that makes it work:** because the domain has an explicit Day Close ritual, there is a **natural, exact, once-per-day aggregation boundary.** At close we materialise `daily_sales_summary`, `daily_item_summary`, `daily_tax_summary`, `daily_staff_summary`. **Every report older than the hot window reads rollups only and never touches a raw partition.** So archiving costs us nothing analytically — we are not trading analytics away to save space, because the analytics never needed the raw rows.

~1.5M rollup rows/year vs ~48M raw. Cold partitions go to Parquet in object storage (~10:1 compression, cents per month) and are **detached, not dropped** — re-attachable if an auditor asks, and **the re-attach drill gets rehearsed in Phase 10, not improvised during an audit.**

**Net effect: the live database size is bounded by the hot window, not by the age of the business.** A five-year-old chain has the same hot footprint as a one-year-old one.

---

## §10.7 — Captain app: PWA or native shell?

**Recommendation: PWA. Confidently — this is the easiest call in the list.**

**The argument the brief expects:** installability, no app-store review, instant updates across a staff of high-churn waiters, one codebase, and offline via the same Dexie/outbox layer the POS already uses. All true.

**The argument that actually decides it:** *we have already built everything the captain app needs.* The offline outbox, the idempotency layer, the domain package, the realtime client — all of it exists for the POS. A native shell would mean **either** reimplementing that stack against a second runtime **or** wrapping a webview and getting a PWA with extra steps and an app-store dependency. **The marginal cost of the PWA is nearly zero; the marginal cost of native is a second offline implementation of the most dangerous subsystem in the product.** That is not a trade, it is a mistake.

**What we genuinely give up, stated honestly:** (1) **no reliable background push on iOS**, which matters not at all — a captain is holding the phone, and "call waiter" can ring the POS and the KDS instead; (2) **no native barcode/NFC** — not needed; (3) **iOS PWA install is a clumsy flow** ("Add to Home Screen"), which is a genuine, real papercut on staff onboarding day and the only cost I take seriously.

**Revisit only if** a pilot restaurant's staff cannot get it installed, or if we need hardware access (a Bluetooth thermal printer on the captain's phone) — and even then, a native shell around the same web app is the answer, not a rewrite.

---

## §10.8 — Is Realtime enough for the KDS?

**Recommendation: no. You are right, and there is a second reason you didn't name — which is the one that actually constrains the architecture.** [ADR-0005](adr/0005-realtime-transport.md).

**Reason 1 (the one you gave):** sockets drop — WiFi roams, tablets sleep, proxies time out, Supabase redeploys. And **reconnection is not resubscription-with-replay**: messages published while disconnected are simply gone. There is no durable log to catch up from. **A KDS that misses a `kot.created` event fails silently** — a screen with a missing ticket looks exactly like a screen with no orders. A guest waits 40 minutes for food nobody is cooking.

**Reason 2 (the one that actually binds):** the **concurrent-connection cap**. Verified: **Free = 200, Pro = 500**, then $10 per 1 000. And the connection count is not driven by the KDS —

> **it is driven by guests.** Staff sockets are bounded by headcount. Guest sockets are not bounded by anything. A single busy Saturday outlet can approach 50–75 concurrent connections, most of them guests with the Booth open. Twenty outlets need thousands.

**So the decision is three things, not one:**

1. **A monotonic `event_seq` per outlet.** A gap (`incoming > last + 1`) triggers an immediate HTTP backfill. **This is the actual mechanism** — it turns "the socket dropped" from silent data loss into a self-healing event. Without it, no amount of reconnection logic helps.
2. **Heartbeat every 10 s; degrade to polling after 30 s, with a visible "reconnecting" state.** **A disconnected KDS must *look* broken** — the ambiguity between "no orders" and "not receiving orders" is the bug.
3. **The Booth polls; it does not hold a socket.** A guest watching order status does not need sub-second latency. This one decision removes 60–80% of peak sockets and keeps us inside the Pro cap for the realistic life of the product. **Sockets are for staff, where the count is bounded by payroll.**

Bonus: the same sequence-numbered event log is what the **offline outbox reconciles against on reconnect** ([ADR-0004](adr/0004-offline-sync.md)). One mechanism, two problems.

---

# What I need from you to close Phase 0

The gate is three approvals:

1. **The domain model** — [DOMAIN.md](DOMAIN.md) and [TENANCY.md](TENANCY.md). Specifically: the `store` correction (Disagreement 2), and the **outlet-boundary rule** in §10.1, which is the one thing I invented rather than derived.
2. **The offline conflict rules** — [DOMAIN.md](DOMAIN.md) §8. The per-entity table.
3. **One design direction** — the [artifact](https://claude.ai/code/artifact/e8f97323-647d-48eb-b462-d25ca38ca37a). I recommend **B (Service Board)** and I have written down exactly where I might be wrong.

And one thing that is not a gate but which I want on the record: **agreement that Phase 8 does not start until a real restaurant has run a real service.** It costs nothing to agree to now and it is very expensive to introduce later.
