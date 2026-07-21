# RestroBooth — Progress

Maintained at the end of every session so the next one starts warm. Current state, not history — see [DECISIONS.md](DECISIONS.md) for the append-only decision log and `git log` for what actually changed.

---

## Where things stand — 2026-07-21 (latest), Bill/Pay UI redesign (POS + Booth)

Pure visual/UX pass, no behavior changes: "the Bill Pay UI on POS and QR looks old." Full rationale: [DECISIONS.md](DECISIONS.md)'s latest entry.

- **POS bill screens** (`apps/pos/app/floor/[sessionId]/bill/`): raw HTML `<select>`/`<input>` controls replaced with the shared `Select`/`Input`/`MoneyInput` components; a new reusable segmented-control pattern (mirroring `PosShell`'s existing nav-pill shape) for finalize mode, discount kind, and refund kind; `PayForm`'s method choice is now tappable icon buttons with a "Needs network" hint (offline-gating logic itself unchanged). Zero new motion — POS's zero-motion rule intact.
- **Booth pay/feedback** (`apps/booth/app/pay/`): hero-total card, "Pay online" split out as its own primary CTA above secondary UPI/cash options (reflecting that only the mock gateway auto-settles; UPI/cash need staff confirmation). Star rating now uses Booth's existing motion allowance. Fixed a real header word-wrap bug on narrow phones (`BoothShell.module.css`).
- **Self-caught bug fix**: a brass-as-text-color violation in `FeedbackForm.module.css` (written during Slice 3, not caught by `lint-brass.mjs` since it only scans `packages/ui`) — fixed to brass-as-fill, matching the established pattern elsewhere.
- **New shared icons**: `CardIcon`, `SmartphoneIcon`, `BankIcon`, `WalletIcon`, `CheckCircleIcon` in `packages/ui`.
- Full-workspace typecheck + lint (incl. brass/motion lints) green; every redesigned screen state verified via real Playwright screenshots.

---

## Where things stand — 2026-07-20, Phase 5 Slice 3: payment + feedback — Phase 5 is now COMPLETE

**The Booth can now take a guest all the way through "QR → order → pay → feedback"** — the full arc ROADMAP.md names for Phase 5. Planned via `EnterPlanMode`, three real design forks resolved with the owner via `AskUserQuestion` before building (settle model, UPI scope, feedback shape). Full rationale: [docs/adr/0010-guest-payment-and-feedback.md](docs/adr/0010-guest-payment-and-feedback.md).

**What shipped:**
- **Hybrid settle model.** A guest paying via the mock gateway ("Pay online") auto-settles and closes the table — the stand-in for a future verified Razorpay. Cash and the real `upi://pay` deep link write a `pending` payment claim instead; staff confirm receipt on POS (`confirmGuestPayment`) before it counts. Real money stays staff-authoritative either way.
- **`PaymentGateway` interface + `MockPaymentGateway`** (`apps/booth/lib/payment-gateway.ts`) — real Razorpay/Cashfree is a later, separate decision that implements the same interface, not a rewrite of the settle path.
- **A real `upi://pay` deep link** (`packages/domain/src/upi.ts`, 100% test coverage) — the NPCI spec is public documentation, not a vendor's private API, so this is genuinely real, not mocked. Needed one new piece of config nowhere in the schema before: `outlets.upi_vpa`/`upi_payee_name` (migration `0029`), seeded for the Ahmedabad/Vastrapur outlet.
- **`finalizeGuestBill`/`payGuestBill`/`submitFeedback`** (`apps/booth/lib/payment-mutations.ts`) — same ADR-0009 privileged-connection pattern every other guest write uses. `resolveOwnSession` (and the page-level `getGuestContext`) gained an `allowClosed` option: the mock path closes the guest's own session as part of paying, and feedback legitimately runs right after.
- **`apps/booth/app/pay`** — a single route, all state transitions client-side after the initial load (no navigation between "choose a method" and "thanks for the feedback," which sidesteps needing the server to re-accept a now-closed session mid-flow).
- **A new `feedback` table** (migration `0029`, partitioned by `business_date` like every other business-event table) — 1–5 rating required, free-text comment optional, one row per visit (`unique(table_session_id, business_date)`). Deliberately minimal: Phase 6's AI layer is what mines aspects/sentiment out of the comment text later, per the brief — this slice only captures the raw signal.
- **POS: confirm a guest's pending payment** — a new row on the bill view (`PendingGuestPaymentRow`) and a "Payment to confirm" state in the floor card's notification band (this session's earlier redesign), prioritized alongside "Waiter called." Not mirrored to Captain — it has no bill screen of its own, a prior decision, unchanged here.

### Still deferred
- Real Razorpay/Cashfree integration + webhook verification (ADR-0001's Hobby→Pro trigger; `PaymentGateway` exists so this is additive, not a rewrite).
- Guest-side split payment, guest-applied discount/service charge — both stay POS-only; a guest always pays one plain, whole bill.
- Offline guest payment (the Booth is a phone that's online if it loaded at all).
- Phase 6's aspect/sentiment extraction from feedback comments.
- Everything the prior entries already deferred (real cross-app SSO, a `service_requests` table, KDS idle policy).

**Phase 5 is complete.** Per ROADMAP.md's plan of record (Phase 1 → 2 → 3a → 3b → 4 → 5 → **PILOT**), the next real milestone isn't a phase — it's a real restaurant running a real service.

---

## Where things stand — 2026-07-20, cleanup pass before Slice 3

Four small items closed out before starting Phase 5 Slice 3 planning. Full detail: [DECISIONS.md](DECISIONS.md)'s "Cleanup pass" entry.

- **`apps/booth` is deployed** (`https://restrobooth-booth.vercel.app/`) — the earlier "still not deployed" note was stale, now corrected. All 6 apps are live on Vercel.
- **Staff-side KOT-number race fixed** — POS's `applyFireOrder` and Captain's `fireOrder` now lock the outlet's `business_days` row before allocating `kot_number`, same as the guest `placeOrder()` path already did (ADR-0009's flagged fast-follow, now done). Verified with real fires through both apps — sequential, non-colliding KOT numbers.
- **"Unseat table" mirrored to Captain** — same action, same dialog, same scoping as POS's original. Verified end-to-end.
- **KDS exempted from the 60-minute idle logout** — removed, not just disabled; the file is deleted. POS, Captain, Console unchanged.

### Still deferred
- Real cross-app SSO (needs a production domain decision).
- A `service_requests` history table, if call-waiter's single-column model ever needs to grow.
- Phase 5 Slice 3 (payment + feedback) — the last piece before the pilot gate. Planning starts next.

---

## Where things stand — 2026-07-20, POS made responsive

**POS now works down to phone width (375px) with zero horizontal overflow on every page.** Full rationale: [DECISIONS.md](DECISIONS.md)'s "POS made responsive" entry.

**The real bug:** `PosShell.module.css`'s header had no responsive handling below ~1100px — nav tabs, search, alerts, and the avatar/sign-out menu fell off-screen at phone width and were genuinely unreachable, not just cramped. Every other page (floor grid, order pad, bill, menu, day) already reflowed correctly. Fixed with pure CSS (`flex-wrap` + `order` on the header's own `<nav>`/`<form>`, no markup changes, no hamburger).

**Also fixed while auditing:** several POS-local buttons hardcoded sub-44px heights (36/40/32px), violating CLAUDE.md's own touch-target floor — switched to the existing `--touch-target` design token (already `44px` at `pos` density) instead of a magic number.

**Verified with real screenshots** at 390/768/820px across every main page plus a dialog, and a scripted `scrollWidth` check confirming zero horizontal overflow at 375px.

### Still deferred
- Nothing new — this was a pure bugfix/audit pass, no scope deferred.

---

## Where things stand — 2026-07-20, 60-min idle logout + SSO deferred

**All 4 staff apps (POS, KDS, Captain, Console) now auto-sign-out after 60 minutes of real inactivity** — no mouse/key/touch/scroll for the full window, with a 60s warning dialog ("Stay signed in") beforehand. Full rationale: [DECISIONS.md](DECISIONS.md)'s "60-minute idle logout + SSO deferred" entry.

**What shipped:**
- `packages/ui/src/components/IdleTimeout.tsx` — `useIdleTimer` (pure activity tracking, no Supabase/router coupling) + `IdleWarningDialog` (presentational, built on the existing `Dialog`).
- `apps/{pos,kds,captain,console}/app/IdleLogoutGuard.tsx` — one tiny client component per app, wiring the shared hook to that app's own existing `signOut` server action (identical across all 4, already used by each app's own header sign-out button). Mounted once inside each app's Shell.
- Verified end-to-end with Playwright at a temporarily shortened timeout (8s) — confirmed the warning fires, the redirect to `/login` happens, the Supabase session is genuinely revoked, and "Stay signed in" correctly resets the clock. Reverted to 60min/60s before committing.

**"SSO for all apps" — researched, then deliberately NOT built full cross-app session sharing.** None of the 5 apps share a production domain today (each is its own separate Vercel deployment), and Hub was built 2026-07-19 specifically around "sign in once you land on it" — real cookie SSO needs a shared root domain, a production-infra decision, not a code change. Asked the owner directly rather than guessing; **chose to hold off.** Shipped instead: Hub (`apps/hub/app/page.tsx`) remembers your last-used tile via same-origin `localStorage` and shows a "Last used" badge — genuinely deliverable without any domain decision, unlike the alternative (passing an email through to prefill login), which turned out to need the same cross-origin mechanism a shared domain would provide.

**Worth a second look:** KDS's idle policy is the same 60-minute blanket rule as everywhere else, but flagged as the one app where "idle" (no touch) doesn't necessarily mean "unattended" — a fixed kitchen screen can go quiet during a lull while still being watched. Noted directly in `apps/kds/app/IdleLogoutGuard.tsx` as the file to revisit if this proves too aggressive in a real shift.

### Still deferred
- Real cross-app SSO (needs a production domain decision first).
- A different idle policy for KDS specifically, if 60 minutes proves too aggressive there.
- Everything the prior entries already deferred.

---

## Where things stand — 2026-07-20, POS: "Unseat table"

**POS can now release a table without billing it.** A "Unseat table" button in the table detail page's header (`apps/pos/app/floor/[sessionId]/OrderPad.tsx`) opens a confirm dialog (`UnseatDialog.tsx`, four reason options), then transitions the session to the domain's existing `abandoned` status via a new `unseatSession` server action. Full rationale: [DECISIONS.md](DECISIONS.md)'s "POS: 'Unseat table'" entry.

**Deliberately narrower than DOMAIN.md §3.1's full "walkout" description** — no manager-auth gate, no expense-ledger posting (neither exists in the schema today). Plain RLS-scoped staff write, same tier as `acknowledgeWaiterCall`, since abandoning never touches a paise field or the ledger. A stronger warning shows in the dialog when the session has fired/served items, but nothing is blocked beyond the domain layer's own `assertSessionTransition`.

**Scoped to POS only** — not mirrored to Captain this pass (unlike most floor-view work this session), since that's what was asked. Worth mirroring later if wanted.

**Verified end-to-end** with real Playwright interaction and a direct Postgres check (status → `abandoned`, `abandoned_reason` set); the warning-copy path (session with a fired KOT) was checked without submitting, to leave that fixture's real data untouched. Test fixture restored afterward.

### Still deferred
- A real manager-authorized "walkout" flow with an expense/ledger line (DOMAIN.md §3.1's fuller description) — no ledger concept exists in this schema yet.
- Mirroring "Unseat table" to Captain, if wanted.

---

## Where things stand — 2026-07-20, floor card redesign: universal notification band

**The floor cards' footer is now structurally fixed-height (48px), always rendered, on both POS and Captain** — closing out a bug the previous entry's call-waiter footer introduced (a variable-height footer stretched its whole grid row when present). Full rationale and the design spec behind it: [DECISIONS.md](DECISIONS.md)'s "Floor card redesign" entry, and [docs/DESIGN.md](docs/DESIGN.md)'s "Amendment 4."

**What shipped:**
- `.notifyBand` (POS `FloorMap.module.css`, Captain `FloorList.module.css`) — every card ends in the same strip regardless of state; content is priority-ordered and mutually exclusive (waiter call > bill status > self-seated tag > empty), never stacked.
- Card border on a waiter-called table de-escalated from full `--signal-600` to a soft `color-mix` tint + shadow — the notification band now carries the alert's colour, not the whole card.
- "Acknowledge" → "Handled", restyled as a ghost button (border+text via `currentColor`, no underline).
- A second, narrowly-scoped motion exception on **POS only** (`.floorMotionScope`, gated by `prefers-reduced-motion`): the band's icon pulses (3s) when critical, and swapped-in content slides up (200ms) on mount. **Not extended to Captain** — flagged to the user, not silently applied, since Captain has no equivalent motion scope today.
- Verified with Playwright screenshots (uniform card height across idle/self-seated/waiter-called states, both apps) and a computed-style check confirming the animation is actually live under `prefers-reduced-motion: no-preference` and correctly off under `reduce`.

### Still deferred
- Extending the icon-pulse/slide motion to Captain, if the user wants it (currently POS-only by design, see above).
- Everything the prior entry already deferred (payment/feedback Slice 3, `apps/booth` Vercel deploy, staff-side `business_days` lock hardening, a `service_requests` history table).

---

## Where things stand — 2026-07-20, Phase 5 Slice 2c: call-waiter

**A guest can now flag staff without ordering anything.** A "Call waiter" bell in the Booth's header ([apps/booth/app/BoothShell.tsx](apps/booth/app/BoothShell.tsx)) is reachable from every page, not just one. This closes out the Slice 2 build sequence — token gate (1) → browse/status board (2a) → self-service ordering (2b) → call-waiter (2c) — the Booth now covers everything ROADMAP.md's Phase 5 line names except payment/feedback (Slice 3).

**Design: a single nullable `table_sessions.waiter_called_at` column** (migration `0028`) — non-null = an outstanding call. No new ADR needed: the guest write reuses ADR-0009's exact `resolveOwnSession` pattern (same file, `apps/booth/lib/order-mutations.ts`'s new `callWaiter()`), and the staff acknowledge is a plain RLS-scoped write like any other floor action — no new security surface, no new capability gate (any staff who can see the table can clear a service call; it isn't a money/void action). The genuinely useful discovery: **both POS's and Captain's floor views already `router.refresh()` on any `table_sessions` realtime change** (wired for occupancy/status, not built for this) — so setting/clearing the column surfaces to staff live with zero new event or socket code.

**What shipped:**
- `apps/booth/lib/order-mutations.ts`'s `callWaiter()` — no menu-freeze guard (unlike `addToCart`): a guest at `bill_requested`/`settling` can still need help.
- The header bell (`BoothShell.tsx`) — brass fill when active ("Waiter notified"), a toast on first call, harmless to re-tap.
- **POS** (`FloorMap.tsx`) and **Captain** (`FloorList.tsx`) both get: a static (no pulse) signal-tone card outline, a "Waiter called" badge, and an inline **Acknowledge** button — same footer/row slot the existing "Guest-opened" and bill-status badges already use. `acknowledgeWaiterCall(sessionId)` in each app's own `floor/actions.ts`.
- **Verified with real UI interaction, not just direct DB checks**: two Playwright scripts (`tools/booth-call-waiter-test.mjs`, `tools/pos-acknowledge-waiter-test.mjs`, both left untracked) — scanned a never-seated table, tapped the real bell button, confirmed the toast and the button's "notified" state; separately, loaded the real POS floor, confirmed the badge/outline/Acknowledge button render correctly, clicked the actual Acknowledge button, and confirmed both the badge disappearing client-side and `waiter_called_at` clearing back to `null` in Postgres.
- **A real environment gotcha hit while migrating**: the live Supabase project's *direct* connection hostname (`db.<ref>.supabase.co`) started failing DNS resolution (`ENOTFOUND`) mid-session, after working fine for three earlier migrations this same session — no code/config change on our side. Root cause not fully diagnosed (plausibly this machine's IPv6 routing/DNS, since Supabase's direct-connection hostname is IPv6-only and the pooler hostname isn't); the **pooled** connection string (already in use for the deployed apps' `DATABASE_URL`) worked immediately as a fallback and applied migration `0028` cleanly. Worth trying the pooler first if the direct hostname ever fails again rather than assuming the migration itself is broken.

### Still deferred
- Payment (mock gateway + real UPI deep-link) and feedback — Slice 3, the actual "pilot-ready" gate.
- `apps/booth` is still not deployed to Vercel — only tested locally/on-phone via dev server so far.
- The staff-side `fireOrder`/`applyFireOrder` `business_days` row-lock hardening ADR-0009 flagged (guest+staff can now fire concurrently) — not done.
- A `service_requests` history table (multiple request types, an audit trail) if the single-column call-waiter model ever needs to grow past the pilot.

---

## Where things stand — 2026-07-19 (latest), Phase 5 Slice 2b: guest self-service ordering

**The Booth can now take a real order end to end: scan → auto-seat → browse → add to cart → place order → real KOT.** See [docs/adr/0009-guest-order-writes.md](docs/adr/0009-guest-order-writes.md) for the full design writeup. Slice 2b's "Next up" scope from the previous entry is now built (ordering half; call-waiter is still deferred, see below).

**The core design decision — a server-side cart:** owner requirement was that the table stays open and re-joinable until an order is actually fired, since a guest might minimize the tab or switch browsers before ordering. This falls out for free from making the cart real server state: tapping "add" writes a `pending` `order_item` immediately (the exact staff model, pending → fired) rather than anything living in browser storage. **Verified for real, not just reasoned about**: opened two completely separate browser contexts against the same table's QR — the second one landed on the exact same cart the first had built, before either had placed the order.

**The write-path mechanism (owner-confirmed via `AskUserQuestion`, choosing between two established patterns):** an anonymous guest cannot write order data today at three layers (table grants are SELECT-only for `anon`; RLS write policies require a staff `memberships` row; the KOT-firing sequence function isn't grantable to `anon`). Rather than open a six-table, two-restrictive-policy `anon`-write surface, guest writes go through a **privileged server action with an app-level ownership check** (`apps/booth/lib/order-mutations.ts`) — every mutation resolves the caller's own table_session from the `rb_guest_session` cookie first, inside the same transaction as the write, so a guest can only ever affect their own table by construction. This is a deliberate, ADR-recorded exception to non-negotiable #7 ("RLS is the security model"), scoped to exactly these three functions — Booth reads and every staff path are unchanged.

**What shipped:**
- `apps/booth/lib/order-mutations.ts` — `addToCart`, `removeFromCart`, `placeOrder`. `placeOrder` is a direct port of `apps/captain`'s `fireOrder` (same kitchen-section grouping, same KOT/event-emit logic) minus the printer-bridge call (a physical-terminal concept a phone has no equivalent of). Added one real hardening the staff paths don't have: `placeOrder` locks the outlet's `business_days` row (`SELECT ... FOR UPDATE`, the same idiom `seatOrJoinTableSession` already uses) before allocating `kot_number`, since guest + staff can now fire the same outlet concurrently — the staff-only `MAX+1` allocation never needed this when only one terminal at a time could plausibly fire.
- **The menu is now tappable** (`apps/booth/app/menu/MenuBrowser.tsx`) — same tap-to-add-1, no-stepper UX as `apps/captain`'s `AddItemPicker` (this design system's established quantity pattern everywhere).
- **"Your order" split into two sections**: `CartSection.tsx` (pending items — editable, removable, a running total, "Place order") above `OrderStatusBoard.tsx` (now fired/served only — the split-flap board keeps its job of showing kitchen status, not cart contents).
- No migration. `channel_code` stays `'dinein'` (a Booth guest is a dine-in order in every sense `resolve_menu` and tax care about; `table_sessions.opened_via='guest'` from the prior amendment already records Booth origin at the session level).
- **Verified end-to-end with a real Playwright script** (`tools/booth-order-test.mjs`, left untracked per this repo's established throwaway-script convention): scanned a fresh unseated table, added 2 items, confirmed the cart total (₹450.00 = ₹150 + ₹300, correct), confirmed a second browser context scanning the same QR saw the identical cart, removed one item, placed the order, confirmed the remaining item's tile flipped to "Cooking" — and confirmed directly in Postgres that a real `kots` row landed (`status: queued`, same as any staff-fired ticket) and the session transitioned to `dining`.

### Still deferred
- **Call-waiter** — no existing signal/notification concept anywhere in the codebase (confirmed net-new in Slice 2a's exploration); not part of "order from the QR," stays out of scope.
- **Guest editing/voiding a *fired* item** — a guest can only remove from the cart (pending, before firing); once fired it's a staff/manager capability, unchanged.
- **Hardening staff-side `fireOrder`/`applyFireOrder` with the same `business_days` row lock** — flagged in ADR-0009 as a fast-follow (the same concurrent-kot-number risk now technically applies staff-side too, since a guest can fire alongside them), not done this pass.
- Payment/feedback remain Slice 3.

---

## Where things stand — 2026-07-19 (even later), ADR-0008 amendment: guest scans auto-seat, no staff pre-seating

**Owner feedback after driving the live deployment, correct and acted on immediately:** requiring staff to seat a table in POS/Captain before a guest's QR scan would work defeated the point of self-service ordering. Reversed — see [docs/adr/0008-guest-token-and-session.md](docs/adr/0008-guest-token-and-session.md)'s amendment banner for the full trade-off writeup (this touches a security assumption, not just UX, so it's documented as a real amendment, not a silent behavior change).

**What changed:**
- A guest's scan now **opens the table itself** if nobody has yet (`apps/booth/lib/scan-queries.ts`'s `seatOrJoinTableSession`) — same shape as `apps/pos/app/floor/actions.ts`'s `applySeatTable` (check for a live session, resolve the open business day, resolve the one active store), but opens one instead of erroring when none exists. Row-locks the table (`select ... for update`) for the transaction's duration so two guests scanning the same table at the same instant can't race into two separate sessions — the second waits, then joins what the first created.
- **Token validity and seat eligibility are now two separate pure functions** in `packages/domain/src/qrToken.ts`: `evaluateGuestTokenAccess()` (hash found / not revoked / not expired — unchanged) and the new `evaluateGuestSeatEligibility()` (is there an open business day at the outlet, is the table flagged `out_of_service`). The old conflated "table must already have an open session" check is gone entirely.
- **New column `table_sessions.opened_via` (`'staff' | 'guest'`, migration `0027`, default `'staff'`)** — the accepted mitigation for the weakened off-premises defense (a still-valid, unrotated token can now open a session from anywhere, not just the table — named and accepted, not silently dropped). Surfaces as a **"Guest-opened" badge** on both `apps/pos`'s and `apps/captain`'s floor views (same "separate signal, not folded into the state chip" pattern the bill-status badge already uses), so staff notice a table that opened itself.
- RLS adversarial suite's A14 block updated (46/46 still passing) — A14d/e no longer assert on table_session state, since that's not the token layer's concern anymore.
- **Verified end-to-end for real**: minted a token for a table that had genuinely never been seated by anyone, scanned it cold — it auto-opened, showed up correctly on the live POS floor with the "Guest-opened" badge (screenshot-confirmed), and a second scan of the same token joined the existing session rather than creating a duplicate.

---

## Where things stand — 2026-07-19 (later), Phase 5 Slice 2a (Booth menu browse + live status board)

**Slice 2a is done: the Booth's first real UI.** Sub-sliced deliberately (owner-confirmed via `AskUserQuestion`) into 2a (read-only: menu browse + the live status board) and 2b (guest self-service order-writes — not started, see below) — because an anonymous guest **cannot currently write order data** (both `order_item_isolation` and the restrictive `order_item_take_capability` policy require a staff `memberships` row), so guest ordering is a new security surface deserving its own focused pass, same as Slice 1 was for the token gate.

**What exists and works right now:**
- **`apps/booth/app/layout.tsx`** is no longer a stub — real fonts (Bricolage Grotesque/Inter/IBM Plex Mono, matching Console's setup), tokens, `DensityProvider density="booth"` (unlocks 48px targets, the larger type/space scale, and full motion for free — the booth density blocks already existed in `packages/ui`'s token CSS, no token work was needed), `AmbientBackground mode="animate"` (Booth is the one app that's full-motion unconditionally, per DESIGN.md Direction B).
- **`apps/booth/lib/guest-context.ts`** — `getGuestContext()`, the "is my session still live" check every Booth page runs first (privileged read: cookie → `guest_sessions ⋈ table_sessions` → null if expired or the table_session has gone terminal). Not the same check as Slice 1's token gate (that's scan-time only) — this re-validates on every page load, since a table_session can turn terminal mid-visit (staff closes it) without the guest's cookie itself expiring.
- **Menu browse** (`apps/booth/lib/menu-queries.ts` + `app/menu/page.tsx`) — reuses `resolve_menu()` (never a second menu source), via a **privileged** read (not `withGuest`): confirmed `resolve_menu` inner-joins `stores`/`dayparts`/`promos`, all empty under an anon guest's RLS, so calling it guest-scoped would silently return zero rows. The menu itself is public data with no per-guest isolation concern, so privileged-but-correct is the right call here. Channel is hardcoded `'dinein'`. Browse-only, no add-to-cart control (Slice 2b's job).
- **The live status board** (`apps/booth/app/OrderStatusBoard.tsx`, `apps/booth/lib/order-queries.ts`) — THIS one goes through `withGuest` (real per-guest isolation concern). New migration **`0026_guest_order_read_policies.sql`** adds `order_item_guest_own_read` and `kot_guest_own_read` (neither table had any `anon` policy before — a guest could read the `orders` header via Slice 1's own `order_guest_own_read` but not its line items or ticket status). Per-item tiles flip (`rotateX` spring, `BOOTH_TRANSITION`) on status change, gated structurally on `useMotionAllowed()` per `packages/ui/src/motion.tsx`'s own instruction for anything beyond `<Animate>`. This is a faithful-but-simplified rendition of DESIGN.md's "split-flap board" — status-flip tiles, not a full character-level Solari board (a later enhancement, not attempted here).
- **`apps/booth/app/BoothPoll.tsx`** — `router.refresh()` every 5s (ADR-0005 §3: the Booth never holds a socket), **gated on the Page Visibility API** — net-new to this codebase; every existing poll (KDS's fallback, the floor map's backstop) gates on `navigator.onLine` only, none on foreground/background. Pauses when the guest backgrounds the tab, refreshes immediately on returning to foreground.
- **`StateRail`** (`packages/ui`) got a new opt-in `glow` prop for DESIGN.md's "glowing card edge on your order" — booth-density-scoped CSS (`box-shadow` using the rail's own color var), applied only to the order-status card, not blanket-applied to every booth-density `StateRail` use (a menu row doesn't want a glow).
- **RLS adversarial suite: 46/46 passing** (4 new guest order_items/kots read cases — 2 positive control, 2 isolation; the isolation half's honesty caveat re: T6 having no seeded order_items is documented inline in the test file, since it means that half doesn't prove as much as a real cross-table leak test would).
- **Driven end-to-end and screenshot-critiqued** (CLAUDE.md rule 11): minted fresh tokens, scanned into a live board showing real item names/quantities with correct status colors (amber "Cooking", green "Served") and a visible glow on the order card; confirmed the empty state ("No items yet…"); confirmed the menu page renders all ~120 real items correctly grouped by category with tabular prices; confirmed Slice 1's no-cookie gate (`proxy.ts`) still redirects to `/invalid` correctly on top of the new layout.

**`apps/booth` is still not deployed to Vercel** — that's a dashboard step for the next session (root `apps/booth`, Function Region `icn1`, single env var `DATABASE_URL`; no `NEXT_PUBLIC_SUPABASE_*` needed, the Booth has no Supabase client).

### Slice 2b — not built, outlined only
Guest self-service **add-to-order** (needs a `security definer` write path or a new `to anon` INSERT policy stacked with an exception to the restrictive `order_item_take_capability` policy — confirmed via exploration that anon categorically cannot write today; this needs its own ADR + adversarial write tests, not just a policy tweak), the **cart**, and **call-waiter** (net-new — no existing signal/notification concept anywhere in the codebase; the `order_status_events` log's `event_type` column is free text so no schema change is needed to emit one, but nothing currently reads a non-`kot` event, so surfacing it on the POS floor is net-new work too). Slice 3 (payment/feedback) is still further out. One concrete open decision for whichever slice actually writes an order: `booth` vs `dinein` `channel_code` (still unresolved — `orders.channel_code` has no CHECK constraint, so either works at the schema level; it's purely an application/override-authoring convention question).

---

## Where things stand — 2026-07-19, live test deployment + Phase 5 Slice 1 (Booth token gate)

**Two threads this session: (1) the app is now deployed live for testing (Vercel Hobby + Supabase Free), (2) Phase 5 (the Booth) has begun — Slice 1 (the guest QR token gate, ADR-0008's A14) is built and verified; Slices 2-3 are not.**

### Live deployment — for testing only, not the pilot

- **Five Vercel Hobby projects** (`restrobooth-pos`, `-kds`, `-captain`, `-console`, `-hub`), each rooted at its `apps/*` directory, GitHub-integration deploy (push to `main` auto-redeploys). Function Region pinned to **`icn1` (Seoul)** on every project — matches the Supabase project's region; leaving it on the `iad1` default caused a real, measured 3-5s-per-click latency (every DB round trip crossed the Pacific). `apps/booth` is **not** deployed yet (Slice 1 has no user-facing UI to deploy).
- **A real Supabase Free project**, `sehgfgusiqxnmearhuzl.supabase.co`, region `ap-northeast-2`. All migrations through `0025` applied. Seeded with the believable-chain fixture + real GoTrue accounts (`owner@`/`cashier@`/`kitchen@restrobooth.test`, password `restrobooth`, same as local). Credentials (DB password, anon key, service_role key) were shared in-conversation, not committed anywhere — if picking this up cold, ask Mohammed for them again rather than searching the repo.
- **`turbo.json`'s `build` task now declares `DATABASE_URL` in `env`** — Vercel's strict env-var checking flagged it as set-but-undeclared. `NEXT_PUBLIC_*` vars needed no change (auto-included via Next.js framework inference).
- **Static, instant pending-state feedback** (disabled + label swap, e.g. "Saving…") was added to the ~9 action buttons that had none (every app's sign-out button, POS's rejected-outbox "Discard" buttons, Captain's floor "Refresh") — **no spinner, no new motion exception**; POS/KDS/Captain's zero-motion rule is unchanged. Everywhere else already had this via `useActionState`.
- **The live cloud DB's table/order data was purged** (13 tables, `table_sessions` → `payments`) via a one-off script, keeping menu/orgs/users and — deliberately — the open `business_day` rows, so the floor is immediately usable. Invoice numbering was **not** reset (gaps are permanent by design).
- **`CLAUDE.md`'s git workflow rule changed mid-session**: no longer pushes automatically after a commit — every commit from here on needs an explicit "push" ask. This is now the standing behavior, not a one-off.
- Full narrative: [DECISIONS.md](DECISIONS.md)'s 2026-07-19 "Live test deployment" entry.

### Phase 5 Slice 1 — the Booth's guest QR token gate

**What exists and works right now:**
- **`packages/domain/src/qrToken.ts`** — `evaluateGuestTokenAccess()`, the pure A14 decision rule (unknown/revoked/expired/no-open-session → denied, in that precedence). 100% line/branch covered.
- **`packages/db/src/guestToken.ts`** — `mintTableToken()` (mints + rotates, revoking any prior live token for that table), `lookupTokenByHash()`, `withGuest()` (the guest-side twin of `withUser`: `set local role anon` + the `request.jwt.claim.guest_session_id` GUC the Phase-1-era RLS policies already read). Migration `0025` adds a DB-level `one_live_token_per_table` partial unique index.
- **`apps/booth`**: `/t/[token]/route.ts` is the actual scan gate — validates before any RLS-scoped query runs, then mints a `guest_sessions` row and sets an opaque `rb_guest_session` cookie (no JWT signing — deliberately reuses the same GUC-based RLS-scoping mechanism the staff path already has; see ADR-0008 for why a real signed JWT would have been redundant infrastructure). `proxy.ts` (this Next version's renamed `middleware.ts`) gates every other route behind having that cookie. `/invalid` is where a denied scan or a missing cookie lands.
- **`packages/db/scripts/mint-table-tokens.ts`** (`pnpm --filter @restrobooth/db tokens:mint [outletCode]`) — provisions/rotates the printed per-table QR tokens; prints the raw `${BOOTH_URL}/t/{token}` URLs once (never stored, never retrievable again).
- **A14 is un-skipped** in the RLS adversarial suite (`packages/db/test/rls/adversarial.test.ts`) — 5 new cases (A14a-e), 42/42 total passing against real Postgres. Note: A14's cases deliberately do NOT import `packages/domain` (see the "not yet independently CI-verified" section below for why) — they prove the real DB round-trip; `evaluateGuestTokenAccess` itself is proven separately and exhaustively in `packages/domain`'s own suite, and the two are only combined inside `apps/booth` (a bundler-mode Next app, like `apps/pos`).
- Full design writeup, including what was already decided vs. genuinely new: [docs/adr/0008-guest-token-and-session.md](docs/adr/0008-guest-token-and-session.md).

**A real architectural constraint found while building:** `packages/db` cannot depend on `packages/domain` — they use incompatible TypeScript module-resolution modes on purpose (`domain` ships raw source for Next's bundler; `db` compiles to a real dist for Node). Don't add `@restrobooth/domain` as a `packages/db` dependency again without re-solving this; it breaks immediately (`tsc` complains about missing `.js` extensions on `domain`'s own internal exports, which must stay extensionless for Next app consumption).

**Known gap, not silently closed:** this Next.js version (16.2.10) renamed `middleware.ts` to `proxy.ts` — worth double-checking against the actual installed Next version before assuming either name in future work; it was caught this session only by checking how `apps/pos`/`apps/console` already do it.

### Slices 2-3 — not built, outlined only

- **Slice 2** (menu browse via the existing `resolveMenu()`, cart, add-to-order, call-waiter, the live split-flap status board per DESIGN.md Direction B, `apps/booth` getting its own Vercel project): not started. Open item to resolve when picking this up: whether guest-added order items get a new `booth` `channel_code` value or ride under `dinein` — currently enumerated values (`dinein/zomato/swiggy/ondc/direct/captain`) don't include one.
- **Slice 3** (payment — `PaymentGateway` interface + mock + real `upi://pay` deep-link + cash, real Razorpay stubbed behind the interface; a new `feedback` table, which doesn't exist anywhere in the schema yet): not started.
- Neither slice has an approved detailed plan yet — only the shape agreed via `AskUserQuestion` (see DECISIONS.md). Write the detailed plan for Slice 2 before starting it, same as Slice 1 got one.

---

## Where things stand — 2026-07-18, Phase 4 (KDS) COMPLETE

**Phases 1–4 are all done and pushed.** Phase 4 — the kitchen display — shipped in full across four checkpoint commits: the ADR-0005 event log (finally written to, after sitting empty since Phase 1), the KDS app shell + static ticket board, bump/recall from the kitchen side, and — the actual gate — the Realtime + heartbeat/polling transport, verified against the literal ROADMAP.md/ADR-0005 acceptance test: KDS network killed for real for a full 30 seconds, 5 KOTs fired from a separate online POS terminal during the outage, zero tickets appeared while genuinely offline, the "reconnecting" banner stayed visible throughout, and on reconnect all 5 appeared correctly ordered with real ages and zero duplicates. Full account in DECISIONS.md's 2026-07-18 entry.

### Phase 4 — the KDS — what exists and works right now

- **The ADR-0005 event log is finally real** (`packages/db/src/orderStatusEvents.ts`'s `emitOrderStatusEvent()` + a new `next_outlet_event_seq()` row-locked counter): `order_status_events`/`outlet_event_counters` existed since Phase 1 and nothing had ever written to them. Wired into `apps/pos`'s `applyFireOrder` (`kot.fired`) and `reprintKot` (`kot.reprinted` — closes Phase 3a's own deferred gap #3), and `apps/captain`'s independent fire path. Verified at the DB level: 50 concurrent callers on one outlet produce 50 distinct, gapless sequence numbers.
- **`apps/kds`** is a real app now, not a scaffold: real auth (ported from `apps/pos`), a `kitchen@restrobooth.test` login (added to `seed-auth-users.ts` — didn't exist before), and a ticket board at `/board` showing every active KOT this session can see, section-filterable (hot/cold/bar), aging-coloured via a new `KOT_AGE_THRESHOLDS` ramp (5/10/15 min — tighter than a table's dwell clock).
- **Bump and recall** (`apps/kds/app/board/actions.ts`) — the one interactive gesture ROADMAP.md's Phase 4 line and DESIGN.md's own mockup actually name (not five separate ack/start/ready buttons). `bumpKot()` walks DOMAIN.md §3.3's forward path from wherever a ticket sits to `bumped` in one click, writing a real status update and an event per hop. `recallKot()` is the one reverse transition, surfaced via a "Recently bumped" strip (a bumped ticket otherwise vanishes from the active board entirely, so recall would have nothing to target without it). Capability-gated by a new `can_manage_kot()` — TENANCY.md §4's actual "Bump a KOT" row: everyone except `brand_manager`.
- **The transport** (`apps/kds/app/board/RealtimeSync.tsx`): a Realtime subscription on `order_status_events` (payload never trusted — any INSERT just triggers a full `router.refresh()`, so a missed message is self-healing by construction) plus a 10s heartbeat against the Realtime client's own socket state, 3 misses (30s) or the browser going offline degrading to 5s polling with a visible "RECONNECTING" banner.
- **Readable at 2 metres, taken seriously**: the KDS density token's `--text-xl` (24px) reads fine at a desk but not across a kitchen — screenshot-critiqued and deliberately overridden in the ticket board's own CSS well past the token ceiling (KOT number/age at 48px, item names at 32px), a stated departure from the shared token system for the one screen where it matters most.

### Real bugs found by killing the network for real, Phase 4 edition

1. **Postgres couldn't infer functional dependency from `GROUP BY k.id` alone** — `kots`' primary key is composite `(id, business_date)` (a partitioned-table artifact), so every board query failed outright until every `k.*` column was added explicitly to the GROUP BY. Found by actually firing a KOT and loading the board, not by review.
2. **A short-lived Playwright test that fired a KOT and closed the browser a second later found nothing on the board** — not a KDS bug: `apps/pos`'s fire path now goes through Phase 3b's offline outbox, so the mutation was still queued locally and hadn't drained to the server yet. A reminder that "closing the page too early" is a real, recurring failure mode now that the write path is local-first, not a one-off from Phase 3b.
3. **The exact `router.refresh()`-while-offline crash from Phase 3b, recurring in a new component**: the polling fallback's first version called `router.refresh()` the instant the browser went offline; the failed fetch forced a hard-navigation fallback that blanked the page entirely. Fixed the same way — gate every refresh call on `navigator.onLine`, not just "the connection seems degraded," and refresh immediately on the `online` event instead of waiting for the next poll tick.
4. **The acceptance test's own first run showed only 4 of 5 fired KOTs after reconnect** — not a KDS bug either: the test script itself closed each POS tab 400ms after clicking Fire, racing the offline outbox's own drain. Fixed by waiting long enough for the mutation to actually land before closing the tab — the same class of bug as #2, this time in test code rather than product code.

### Known gaps in Phase 4 — not silently closed

1. **The randomised chaos-test-in-CI** ADR-0005 also names ("drop the socket at random intervals for 60s of simulated service") is not built — this phase's own deterministic 30s acceptance test proves the mechanism; the CI harness version is a stated fast-follow, not attempted here.
2. **Prep-time tracking and ticket-time anomaly flagging** (ROADMAP.md's Phase 4 line names both) are Phase 9 reporting scope — the aging colour states ARE the operational anomaly signal a cook needs mid-service; historical prep-time analytics are a back-office concern the raw event log already has the data for, just no UI reading it yet.
3. **No cross-outlet KDS aggregation dashboard** — a KDS is physically at one outlet; RLS scopes what a kitchen role sees, and a shared cloud kitchen already shows every store's tickets tagged by brand on the one relevant screen. A chain-wide "all kitchens" view is past the pilot gate.
4. **Realtime RLS enforcement at the Postgres publication level was not independently verified** — the client never trusts the realtime payload's content (only uses it as "something changed, refetch"), which sidesteps the concern architecturally regardless of whether Supabase's realtime layer itself filters by RLS. Worth a dedicated look before this matters for a genuinely multi-tenant deployment.

### Phase 3b Slice 3 — the offline outbox — what exists and works right now

- **ADR-0004's local-first write path, for the five mutations the acceptance test exercises**: seat table, add order item, fire order, finalize bill, settle payment. Every one takes the identical path online or offline — write to a local Dexie outbox (`apps/pos/lib/offline/db.ts`) with a client-generated UUIDv7 idempotency key, return instantly (the UI never waits on a network round trip), drain to the server whenever connectivity allows. No `if (offline)` branch anywhere in the mutation code — this was a hard design constraint to actually hit, not just a stated goal.
- **Real, server-side idempotency enforcement, finally** (`packages/db/src/idempotency.ts`'s `withIdempotency()`): the `idempotency_keys` table existed since Phase 1 but nothing had ever queried it — every mutation generated its own key server-side, which provided zero replay protection. Now: same key + same body → the stored response, no re-execution; same key + different body → a loud rejection, never a silent pick-one.
- **The order pad and bill screens are now one page** (`TableWorkspace.tsx`), switched with client-side state, not a route change — a real, load-bearing discovery: Next.js's client router refetches from the server on every dynamic-route navigation, even to an already-visited page, so a route change is not offline-safe by construction in this app regardless of how good the write path is. The bill preview is computed live from the local outbox overlay using `packages/domain`'s own `computeBill()` — the same function the server runs, so the offline total is exact, not an estimate.
- **A cross-tab mutex** (`navigator.locks`) around the outbox drain: IndexedDB is shared across every tab of one origin, and multiple tabs draining concurrently raced on the same "pending" snapshot, each independently calling the server for the same entry. Only one tab drains at a time now; every other tab still picks up the result via Dexie's own cross-tab change events.
- **A working offline status indicator** (`OfflineStatusBar.tsx`, mounted in `PosShell`): an "offline" pill, a live "N syncing" count, and a "needs attention" list for genuinely rejected mutations with a discard action — ADR-0004's "surfaced to the human, never silently dropped" requirement, and the one place in the UI that's allowed to look different when offline (POS is supposed to look and feel exactly normal otherwise — the inverse of KDS's alarm-on-disconnect rule).
- **Verified against the real acceptance test** (`tools/pos-offline-acceptance-test.mjs`, Playwright's `context.setOffline()` — an actual killed network, not a mock): 4 tables seated, ordered, fired, billed, and paid entirely offline in separate already-loaded tabs; reconnect; all 4 correctly invoiced and settled; network killed again with a second terminal (a different login) also queuing a full cycle offline; reconnect; zero duplicates, zero losses, 5 sequential invoice numbers.

### Real bugs found by killing the network for real, not by reasoning about it

1. **Next.js dynamic routes always refetch on navigation, even to an already-visited page.** Confirmed directly: killed the network, clicked an already-visited "Go to bill" link, got a hard navigation error instead of a cache hit. This blocks the entire offline-billing flow unless navigation is avoided — fixed by merging order-pad and bill into one page (see above), not by trying to fight the router's caching behavior.
2. **A brand-new tab's first Dexie query resolution already contains `applied` entries from earlier in the session** (another table's seating, say) — a naive "did the applied count just increase" check misreads that as a fresh completion on mount. Fixed by tracking "has this query resolved once" and only comparing on genuine subsequent increases.
3. **`router.refresh()`'s own fetch fails while offline, and Next's client router falls back to a hard navigation** — which then can't load at all offline, crashing the tab to a `chrome-error` page. This was the actual root cause the adversarial test's early failures traced back to (not the outbox logic itself). Fixed by gating every `router.refresh()` call on `navigator.onLine`.
4. **Multiple tabs sharing one IndexedDB outbox raced on the same "pending" snapshot**, each calling the server for the same entry concurrently — the loser's transaction failed on the `idempotency_keys` unique-key collision. Postgres's constraint stopped this from becoming duplicate *data*, but the losing tab's own local view got stuck showing a false rejection. Fixed with a `navigator.locks` mutex (see above).
5. **Different tables can belong to different stores with entirely different menus** (Spice Route vs Wok Express) — a test bug, not a product one, but worth remembering: never hardcode a menu item name in a cross-outlet test fixture.

### Known gaps in the offline path — not silently closed

1. **Seating a BRAND NEW table starting from a fully offline `/floor` page does not work.** The very first navigation to a session's order-pad page still needs the network (Next.js can't serve a never-before-rendered dynamic route without one), and fixing that needs a service-worker/app-shell layer — genuinely separate infrastructure from Dexie+outbox, not attempted this pass. What **does** work fully offline: continuing service on a table whose order-pad page is already open when the network drops — add items, fire, bill, and settle, all without further navigation. This is the dominant real-world case (a table already seated when the WiFi drops mid-service) and is what the acceptance test exercises.
2. **Void, refund, split-bill, and day-close remain online-only** — matching the plan's original Slice 3 scope cut, not a new gap. Only the five mutations the acceptance test needs (seat, add item, fire, finalize, settle) went through the local-first rewrite.
3. **The UPI/card payment-method options have a one-tick timing gap**: `useOnlineStatus()` starts `true` on mount (same hydration-safe pattern as the app's other live clocks) and corrects itself a moment later, so a payment form that mounts in the same instant the network drops can briefly show UPI as selectable before it greys out. Cosmetic — the queued mutation still resolves correctly either way — not fixed this pass.
4. **No IndexedDB encryption-at-rest or remote-wipe** — ADR-0004 §5 already named this as a Phase 10 security-review item, not solved here. Current local retention is whatever the browser keeps; no explicit "clear on logout" was added this pass either.
5. **No PII/local-retention cleanup** and no automated pruning of old `applied`/`rejected` outbox rows — the outbox grows unboundedly across a long session. Harmless at pilot scale (a business day's worth of mutations), worth a follow-up before it isn't.

### Phase 3b Slices 1–2 (unchanged from before — see the previous entry below for full detail)

### Phase 3b Slices 1–2 — what exists and works right now

- **`packages/domain` money math, 100% line/branch coverage** (a first for this project — the threshold was previously commented out). `money.ts` (half-up rounding, largest-remainder allocation), `bill.ts` (`computeBill()` — DOMAIN.md §5.8's fixed pipeline), `splitBill.ts` (`splitByShares`/`splitByAmount`), `invoiceNumber.ts` (format/validate, FY-from-business-date). Every DOMAIN.md §7 worked example is a test fixture, verified to the exact paise. 106 tests total in the package.
- **Day open/close** (`apps/pos/app/day`): manager-only (capability-gated), per-terminal opening-float drawer tracking (`terminal_day_drawers`, migration `0018` — didn't exist before this phase; DOMAIN.md §4.4 needs it).
- **Bill finalize → settle (split tender) → void**, and **settled → refunded via credit note** (`apps/pos/app/floor/[sessionId]/bill`): server-authoritative via `computeBill()`, invoice number drawn from a row-locked per-terminal block at finalise (never before — a discarded draft burns no number), split tender verified (two partial payments summing to payable), direct void of a finalised-unsettled bill returns the table to dining, refund of a settled bill issues a credit note (own `A1CN/...` series, manager-gated, DB trigger caps it at the bill's payable) and never touches the original invoice.
- **Split-bill** (item/guest with shared items, and equal-N-way by amount): a session can now hold several independent finalised bills at once; `reconcileSessionAfterBillChange()` closes the table once every bill is resolved (settled or voided), reopens to dining only if all were voided. Item/guest split is computed directly against real order_items (not the pooled `splitByShares`) so each split invoice's line items stay traceable to what was actually ordered.
- **A real, browser-printable GST tax invoice view** (`apps/pos/app/bill/[billId]`): legal name/trade name/GSTIN, per-tax-class CGST/SGST breakup, payments, and any credit notes issued against it — reads a durable `bill_lines` snapshot (migration `0020`), never live `order_items`, so a later menu-item rename can never silently rewrite an already-issued invoice.
- **Three real schema gaps found by building against DOMAIN.md's own spec, each fixed with a migration**: `terminal_day_drawers` (0018, no per-terminal float tracking existed), `bills.table_session_id` (0019, nothing traced a bill back to its session), `bill_lines` (0020, nothing snapshot which order_items a finalised bill covers). Plus a new `credit_notes` table (0021) and a `"settling" → "dining"` addition to the table_session state machine (needed for direct void to return a table to service).
- **A real bug caught by a DB constraint, not by typecheck**: the first draft of amount-split hand-computed `round_off_paise = 0`, which is wrong — `splitByAmount()` allocates `payablePaise` independently from `subtotalPaise`/`taxPaise`, so they don't naturally reconcile, and the `totals_reconcile` CHECK caught it immediately in browser testing. Fixed by allocating the payable split in whole rupees (not paise) and computing the real reconciling round-off.
- **Verified via Playwright throughout** (`tools/pos-*-test.mjs`, throwaway scripts per the established pattern) against real seeded data: finalize/settle/void, split tender, a 3-way amount split reconciling to the exact rupee, an item/guest split with a shared item producing two correctly-attributed invoices, a manager's refund succeeding and a cashier's refund attempt being rejected by RLS with the transaction rolled back atomically.

### Known gaps — not silently closed, need a human or a follow-up session (Phase 3b)

1. **Slice 3 (offline outbox, Dexie/IndexedDB, the adversarial reconnect test) has not been started.** This is the actual gate ROADMAP.md names for this phase and the most novel/highest-risk piece — flagged in the approved plan as likely to extend past one session.
2. **Discount and split-bill don't compose.** `splitBillByItems`/`splitBillByAmount` don't accept a bill-level discount or service charge in this v1 — only the single-bill `finalizeBill` path does. Not a silent gap: DOMAIN.md doesn't specify the interaction, and stacking them correctly (which line's discount pool feeds which split?) is a real design question, not a quick add.
3. **Amount-split's `bill_lines` is a synthetic summary line, not real items.** There's no natural per-item attribution for "just divide the check evenly" — each amount-split invoice shows "Bill share N of M" rather than the actual dishes. Item/guest split doesn't have this limitation.
4. **No HSN/SAC code on the invoice view.** Neither `menu_items` nor `tax_classes` carries one — a real schema gap, not fabricated data. Flagging per CLAUDE.md's "never invent an API contract" rule rather than inventing a placeholder code.
5. **Reports (day-end, tax summary, gap register) remain Phase 9 scope**, as the plan always intended — day close writes the data, nothing reads it into a UI yet.

### Phase 3a's carried-forward gaps (unchanged this session)

Table split/move, `table_sessions` INSERT capability gate, reprint print-event row, realtime chaos-testing, and buying a real thermal printer — see the previous entry below; none of these were touched in Phase 3b.

### Phase 3a — what exists and works right now

- **`packages/domain` has real code for the first time** (Phases 1–2 shipped it as an empty, tested-empty shell). Three state machines (`table_session`, `order_item`, `kot`, DOMAIN.md §3.1–3.3) plus `rail.ts` (the state-rail's time-temperature ramp as a pure function). 30 tests, all-pairs transition coverage.
- **`apps/pos`**: real auth, a floor map (`/floor`, state-rail-coded by table dwell time, live via Supabase Realtime), and a full order pad (`/floor/[sessionId]`) — add items with server-resolved pricing, fire (routes to one KOT per kitchen section touched), a mock printer bridge with a real 10-second no-ACK alarm, reprint, the full pre-fire-free / post-fire-manager-gated void flow, same-store merge.
- **`apps/captain`**: real auth, a real PWA (installable manifest + generated icon), a mobile-first floor list and order screen — narrower scope than POS by design (seat, add items, fire, flag-for-void, call for bill; no merge/reprint/void-approval, which are POS/manager surfaces per TENANCY.md's capability matrix).
- **`packages/db`**: schema through migration `0015`. New capability migration (`0014`) enforces "take an order" by role and gates post-fire voids server-side (never trust the client's claim about who's authorizing). `0015` adds `table_sessions`/`kots` to the `supabase_realtime` publication (guarded — the docker-compose bench DB has no Supabase stack, so this no-ops there).
- **Both correctness suites pass, 54 tests** (was 44 in Phase 2), 2 legitimately skipped (A7 — bills, Phase 3b; A14 — QR tokens, Phase 5). 10 new Phase 3a capability tests, same shape as A6/A9.
- **A real architectural fix**: `packages/domain` now uses bundler-mode module resolution (matching `packages/ui`, not `packages/db`) — it ships raw source into Next apps via `transpilePackages`, which needs extensionless imports; NodeNext's `.js` suffixes (needed only for its own `vitest` run) broke the build the first time anything outside its own test suite consumed it. Same ESLint guard `packages/ui` already carries now applies here too.
- **Ten real bugs found and fixed via the Playwright inspection tooling actually driving the running apps** — not caught by typecheck/lint/build, which all stayed green throughout. Full list with root causes in DECISIONS.md; the two worth remembering for future Server Action work: (a) never `Promise.all()` multiple queries sharing one transaction-bound `pg` client — it silently serialises today, errors in a future major version; (b) a `LEFT JOIN` with the filter condition in the `ON` clause does not eliminate non-matching rows, it just nulls them — for "give me the one currently-active X" queries, use `LEFT JOIN LATERAL (... LIMIT 1) ON true`.

### Known gaps — not silently closed, need a human or a follow-up session

1. **Table split and move are not built.** ROADMAP.md's Phase 3a build list names "merge / split / move"; only merge shipped. Split is deliberately deferred to Phase 3b (DOMAIN.md §3.1 says so itself — real split support is billing-time). Move (reassign a session to a different table) just wasn't reached; cheapest of the three to add later.
2. **`table_sessions` INSERT has no role-capability gate**, unlike `orders`/`order_items` — a kitchen/brand_manager role could open an empty table session directly against the DB (never through either app's UI). Harmless in practice (adding an *item* to it IS gated), noted rather than fixed under time pressure.
3. **Reprint does not write a print-event row.** ROADMAP.md's acceptance line asks for both the `reprint_count` increment (shipped) and a print event (not shipped — `order_status_events` exists in schema, nothing writes to it yet). Deliberately deferred to Phase 4, when the full event-seq/gap-detection consumer gets built anyway.
4. **Realtime is configured, not chaos-tested.** The publication and subscriptions are real and verified to exist; no two-browser-session test proved a push actually lands without a manual reload, and there's no heartbeat/polling fallback yet (ADR-0005 scopes that resilience work to Phase 4/KDS explicitly — this isn't a shortfall against Phase 3a's own acceptance criteria).
5. **No real thermal printer bought.** ROADMAP.md: "buy a real thermal printer — do not discover the code-page problem during a pilot." A hardware purchase, not something buildable; flagging again since it's easy to forget until it's urgent.
6. **A7 and A14 still `test.skip`, correctly** — bill-creation (Phase 3b) and QR-token (Phase 5) capability, respectively.
7. **Phase 2's CI status was never re-verified this session.** No network access was available from the tool to check the GitHub Actions API. Phase 1's CI was confirmed green via a direct API check in an earlier session; Phase 2 and Phase 3a's pushes have not had the same independent confirmation — worth checking `origin/main`'s Actions tab next time there's a live connection.

### Local dev fixtures — restore ritual after any test run
The test suite's `globalSetup` truncates and reseeds the believable chain, which drops the GoTrue-linked memberships, categories, and kitchen-section routing. After running `pnpm test`, restore the app's dev state with:
```
pnpm --filter @restrobooth/db seed:auth && pnpm --filter @restrobooth/db seed:categories && pnpm --filter @restrobooth/db seed:kitchen-sections
```
All three are idempotent. (Docker on this machine also keeps stopping on its own — if the DB is unreachable, restart Docker Desktop, wait ~20s, containers self-recover with data intact — this recurred again this session, same non-fix as before.)

**New this session: the Supabase-local GoTrue store isn't always persistent across a long session** — partway through, previously-working login credentials for `owner@restrobooth.test`/`cashier@restrobooth.test` started failing with "Invalid login credentials" even though nothing in this repo touched auth. Re-running `pnpm --filter @restrobooth/db seed:auth` recreated both accounts cleanly (it's idempotent — finds-or-creates by email, then repoints `memberships`). This recurred *repeatedly* while building the offline outbox (roughly every 20–30 minutes of active testing) — if login suddenly stops working with no obvious cause, just re-run the full restore ritual again; it is not a sign of a code regression, and it is cheap.

**The offline acceptance test consumes tables.** Each full run of `tools/pos-offline-acceptance-test.mjs` seats and settles 4–5 tables permanently (there's no "unseat"). Re-running it (or any manual offline testing) repeatedly will exhaust the seeded floor's available tables — when `getByRole('button', { name: /available/ })` starts returning fewer than expected, that's why. Full reseed before the next attempt: `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx tsx packages/db/scripts/seed-believable-chain.ts`, then the usual `seed:auth`/`seed:categories`/`seed:kitchen-sections`, then re-run `tools/login-and-save-state.mjs` for both accounts (the reseed regenerates GoTrue user ids). The Supabase-local DB was left in this "several tables occupied" state at the end of this session — expect to reseed before the next one starts.

### Local environment, for picking this back up

- **docker-compose Postgres** on port 54329 (`restrobooth`/`restrobooth`) — day-to-day schema dev + the 9M-row bench fixture. Has all migrations through `0021` (the realtime-publication migration no-ops here — no Supabase stack).
- **Supabase CLI local stack** — `C:\Users\Mohammed\bin\supabase.exe`, direct Postgres on **54322** (`postgres`/`postgres`), API/GoTrue on 54321, Studio on 54323. Start with `supabase start`. This is what the test suites and all three Next apps (`apps/console`, `apps/pos`, `apps/captain`) point at. **Migrations must be applied to BOTH this and the docker-compose DB** — `npx drizzle-kit migrate` for the default (docker), `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx drizzle-kit migrate` for Supabase-local.
- **Two seeded accounts for manual login** on any of the three apps (`localhost:3000/login` or `:3001` for `apps/pos` if `:3000` is taken): `owner@restrobooth.test` (org_owner — can approve voids, publish prices, manage day/void/discount/refund) / `cashier@restrobooth.test` (cashier — can take orders and settle bills, cannot approve a post-fire void, publish a price, manage the day, apply a large discount, or void/refund a bill), password `restrobooth` for both. Re-run `seed:auth` after every `pnpm seed` — see the restore ritual above, and the GoTrue-persistence note above it.
- **The browser inspection tooling** (`tools/screenshot.mjs`, `tools/login-and-save-state.mjs`, installed 2026-07-16) is what found essentially every real bug this phase, Phase 3b included (the `totals_reconcile` amount-split bug, the `bills.table_session_id` join bug, the hydration mismatches). `pnpm screenshot <url> <out.png> [--full-page --width=N --height=N --state=path --clip=x,y,w,h --wait=ms]`; `pnpm login:save-state <baseUrl> <email> <password> <out.json>` gets an authenticated storageState first. For anything beyond a static screenshot (clicking through a flow, checking console errors), write a small throwaway Playwright script in `tools/`, run it — this session left several `tools/pos-*-test.mjs` scripts in place as a record of what was verified rather than deleting them; they're untracked (not gitignored, just never `git add`ed) so they don't clutter the repo but remain available to re-run.
- **Three Next dev servers, one port.** `apps/console`, `apps/pos`, and `apps/captain` all default to port 3000 — only run one at a time locally, or pass a different port. Each has its own `.env.local` (all three point at the same Supabase-local stack).

### Not yet independently CI-verified
Every commit through `b7f8fdf` (Phase 4 Slice 4, the KDS realtime gate) is pushed to `origin/main`. GitHub Actions should have triggered on all of them; not independently confirmed this session (no network access to the GitHub Actions API) — same standing gap as every prior phase, worth checking next time there's a live connection.

### Local dev fixtures — a reminder specific to Phase 4 work
Docker Desktop was found fully stopped partway through this session (not just the containers idle — the daemon itself wasn't running), which silently no-ops any migration attempt rather than erroring loudly at the point you'd notice. If a migration seems to apply cleanly but a later query says the function/table doesn't exist, check `docker ps` first before assuming the migration logic is wrong. Restarting Docker Desktop and waiting ~15-20s is enough; containers self-recover with data intact.

---

## Next up: Phase 5 Slice 3 — payment + feedback (the pilot-ready gate)

**Slices 1 (token gate), 2a (menu browse + live status board), 2b (self-service ordering), and 2c (call-waiter) are all done** — see the sections above, ADR-0008, ADR-0009, and migrations `0026`–`0028`. A guest can scan, browse, order, watch their KOT cook, and flag staff, entirely unassisted. **Slice 2 is complete.** Phase 5 is not yet "pilot-ready" — that's Slice 3, the last piece.

Next up is **Slice 3**: payment (the confirmed plan — a `PaymentGateway` interface + mock gateway + the real, accountless `upi://pay` deep-link + cash, real Razorpay stubbed behind the interface, per the decision already recorded in DECISIONS.md) and post-meal feedback (a new table — nothing exists in the schema yet). Write an approved, detailed plan before starting, same as every slice so far.

Also still outstanding, unrelated to Slice 3: **deploy `apps/booth` to Vercel** (root `apps/booth`, Function Region `icn1`, single env var `DATABASE_URL` — no Supabase client needed) — the live deployment currently only has pos/kds/captain/console/hub, so nothing built in Phase 5 is actually live yet, only tested locally; **hardening staff-side `fireOrder`/`applyFireOrder`** with the same `business_days` row lock ADR-0009 added to the guest path (flagged there as a fast-follow, not done); a `service_requests` table if call-waiter's single-column model ever needs to grow.

**ADR-0001 still says Phase 5 (specifically Slice 3's payment feature) triggers the move to Vercel Pro + Supabase Pro (~$45/mo)** — accepting a REAL guest payment is commercial use by Vercel's own fair-use definition. This session's live deployment stays free-tier-legal precisely because Slice 3 (the only payment-processing slice) hasn't been built yet, and when it is, the plan is a mock gateway + the real (accountless) UPI deep-link first — see the confirmed decision in DECISIONS.md. Budget for the Pro move before wiring a real Razorpay account, not at "first paying customer."

Before starting Slice 2b, worth a conscious look rather than assuming carry-forward: Phase 3b's offline-path gaps (new-table-seating-while-offline needs a service worker; void/refund/split-bill/day-close are online-only) and Phase 4's own gaps are real, scoped-out-on-purpose limits, not oversights — re-confirm they're still acceptable. Slice 2b is the first slice where a guest actually WRITES to shared state, so it's worth re-reading ADR-0008 (the token/session trust boundary Slice 2b's writes will sit on top of) before starting, not just this summary.
