# RestroBooth — Phase 0 & Phase 1, explained in plain language

This is the non-technical version of what happened in the first two phases of building RestroBooth. If you want the full technical detail, the rest of `docs/` has it — this is the "explain it to a smart friend who isn't a programmer" version.

---

## What RestroBooth is, in one sentence

Software that runs a restaurant's entire day — taking orders, printing kitchen tickets, billing guests, handling tax — designed from day one to work for a *chain* of restaurants (multiple brands, multiple locations, sometimes several brands cooking out of the same kitchen), not just a single shop.

---

## Phase 0: "Figure out exactly what we're building, before writing a line of code"

Phase 0 produced zero working software. That was the point. It was the planning phase — get the hard decisions right on paper, because fixing a wrong decision after the software exists is far more expensive than fixing it in a document.

### 1. We mapped out how the business actually works

Before any screen or database table, we had to answer questions like:
- If a restaurant chain has 20 locations, how does the system know which staff member can see which location's data?
- If one physical kitchen cooks for four different restaurant brands (a "cloud kitchen"), how do we keep each brand's menu, orders, and money separate — even though they share a stove?
- A dish can have different prices depending on: which specific location, whether it's a delivery app or dine-in, time of day (happy hour), and active promotions. How do we decide the *one correct price* when several of those rules could apply at once?
- Indian tax law (GST) requires specific, careful handling — different tax rates for food vs. packaged goods, different rules for restaurants in different states, and strict rules about invoice numbers (they can never be skipped, reused, or renumbered).
- What happens if the internet drops mid-dinner-rush and a waiter's tablet goes offline? What happens when it reconnects — do we lose orders, or double-bill someone?

We wrote all of this down as firm rules, mostly in `docs/TENANCY.md` (who can see what) and `docs/DOMAIN.md` (how orders/kitchen tickets/bills behave).

### 2. We made the big, hard-to-reverse technical decisions

Things like: which cloud provider to build on, which database technology, how to number invoices so they're legally defensible, how a kitchen-ticket reprint should behave (it should *never* create a second ticket, only increment a "reprinted" counter). Each of these got written up as a short decision record (an "ADR") explaining what we chose and why — so six months from now nobody re-argues a settled question from scratch.

Two of these decisions were flagged as **provisional** — meaning "this is our best judgment, but it's genuinely a guess until we test it for real at scale." Both concerned *performance*:
- Will the security system (see below) still be fast once there are millions of orders in the database?
- Will looking up "what does this dish cost right now, at this location, on this app" still be fast once there are hundreds of locations and thousands of menu items?

We deliberately did **not** pretend to know the answer. We wrote down exactly what test would prove it one way or the other, and left both marked "unresolved — Phase 1 must settle this before Phase 2 builds on top of it."

### 3. We picked a visual design direction

Three different visual styles were designed and compared (a bold "kitchen ticket" theme, an "industrial kitchen" theme, and a "live floor-map" theme). We picked the "industrial kitchen" one — deep green, dark steel, one warm brass accent color — because its signature idea (every element gets a colored edge that shows its status, like a ticket turning from green to orange to red as it ages) actually makes the busiest, most cluttered screens *more* usable, not just prettier. The other two looked better in a screenshot but made the actual working screens (kitchen display, checkout) worse.

### 4. We caught three mistakes in the original brief

Re-reading the original project brief critically, three things in it turned out to be wrong or unrealistic once we thought them through carefully (e.g., it said menu price overrides should be tied to a physical *location* — but that breaks the moment two brands share one kitchen; it should be tied to the *brand-at-that-location* instead). We corrected all three in the source document and logged why, so nobody accidentally reintroduces the bug later.

**End of Phase 0: a complete paper plan, with two open questions explicitly flagged as "unproven, test before you build on this."**

---

## Phase 1: "Build the foundation, and settle the open questions for real"

Phase 1 is where code started existing. The goal was specifically **not** to build any restaurant-facing features yet (no menu screen, no checkout button) — it was to build the *foundation* everything else stands on, and to actually answer the two questions Phase 0 left open.

### 1. Built the actual database

Roughly 36 tables covering every entity in the business: organizations, brands, restaurant locations, menu items, orders, kitchen tickets, bills, payments, tax records, staff accounts, and more. This is the system's single source of truth.

### 2. Built the security model — and tried to break it on purpose

The core promise is: **a staff member at Restaurant Chain A can never see Restaurant Chain B's data — not their orders, not their sales, not their staff list — even if both chains happen to use the exact same shared kitchen.** This is enforced at the database level (not just "the app is supposed to hide it" — the database itself physically refuses to hand over rows a given user isn't allowed to see, no matter which piece of software is asking).

To prove this actually works, we wrote **15 deliberate break-in attempts** — e.g., "log in as Brand A's manager and try to read Brand B's orders, at the exact same physical kitchen" — and confirmed every single one gets refused. This is the single most important thing in the whole product to get right, because getting it wrong doesn't cause a crash, it causes a silent, embarrassing data leak between competing restaurant chains.

### 3. Built the pricing engine — and tested every possible combination

A dish's price can be affected by up to four independent factors at once (which location, which sales channel, time of day, active promotion), and they need to combine in a specific priority order — with a critical rule that price and "is this available right now" must be decided *independently*, so that marking a dish as sold-out never accidentally wipes out a separate discount that was also active.

We built a table of **21 test scenarios** covering every meaningful combination (including tricky edge cases like "two staff members published conflicting discounts — who wins?" and "a price change was scheduled for tomorrow — does it correctly *not* apply yet?") and confirmed the pricing engine gets every single one right.

### 4. Generated a realistic fake restaurant chain to stress-test everything

We built a data generator that produces a *believable* pretend restaurant chain (multiple brands, multiple cities, a shared cloud kitchen, hundreds of menu items) for everyday testing, and separately a much bigger, harsher version: **20 locations and roughly 2.3 million fake orders (9 million individual food items)** — deliberately sized to match what a real, established chain would look like after a year in business.

### 5. Answered the two open questions from Phase 0 — with real numbers, not guesses

This was the actual point of Phase 1. We ran timed tests against that 2.3-million-order fake chain:

- **Is the security system still fast at that scale?** Yes — every kind of screen we tested (checkout, kitchen display, floor map, end-of-day report) responded in single-digit-to-low-double-digit milliseconds, comfortably inside the target. ✅
- **Is the pricing engine still fast at that scale?** Yes — resolving an entire restaurant's menu (200 items) took about 3 milliseconds against a 50-millisecond budget — more than 15 times faster than required. ✅

Both of Phase 0's "we think this will work, but we're not sure" decisions are now backed by real measurements instead of judgment calls.

**A genuinely useful side effect: this process caught real bugs before they ever reached a real restaurant.** Along the way, the stress test found two screens that were *dramatically* slow (up to 40x slower than acceptable) — not because the security system was slow, but because two database tables were simply missing an index (like a book missing a table of contents — the information's there, but the computer has to read every single page to find anything). We found it, fixed it, and reran the test to confirm it was actually fixed. This is exactly the kind of problem you want a computer to catch on a fake chain in a test environment, not a real manager complaining that the kitchen screen is frozen during Saturday dinner rush.

### 6. Built the visual building blocks

Ten reusable visual components (buttons, cards, input fields, a pop-up dialog, tabs, a notification toast, and the signature "colored status edge" element) implementing the chosen design direction, and a page where all ten can be seen and inspected together at once, at three different screen densities (a big, friendly tablet screen for guests; a dense, high-contrast screen for the checkout counter and kitchen; a calm, spacious screen for the owner's back-office reports).

### 7. Set up automatic checks for every future change

From now on, every time code is changed, a robot automatically re-runs: the style checker, the type checker, a full build, the 15 security break-in attempts, and the 21 pricing scenarios — and blocks the change if anything fails. This means a future mistake (even a small typo in a security rule) gets caught automatically within minutes, instead of being discovered by a real customer.

---

## Where things stand now

Phase 1 is complete and verified — including a live run of the automatic checks described above, which passed cleanly. Nothing user-facing has been built yet (no menu screen, no checkout, no kitchen display) — that starts in Phase 2. Per the project's own standing rule, the more ambitious, "exciting" chain-management features (central kitchen coordination, franchise royalty tracking, multi-outlet dashboards) are deliberately locked out until a real restaurant has run a real day of service on this system — not a demo, an actual paying customer's actual Tuesday night.
