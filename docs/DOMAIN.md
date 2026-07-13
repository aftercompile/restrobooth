# RestroBooth — Domain Model

**Status: ✅ APPROVED — 2026-07-13**, with one exception: **§8 (offline conflict rules) is PARKED, not approved.** See the banner on §8.
Entities, the four state machines, the business-day rule, the money rules, invoice numbering, and every worked example in §7 are settled. **Phase 1 builds to this.**
**Last updated:** 2026-07-13

This is the specification for `packages/domain`: pure functions, no I/O, no framework, exhaustive tests. Every numeric example in §7 is arithmetically checked and is meant to be transcribed into a test fixture verbatim.

**Standing rule: money is `bigint` paise. There is no float anywhere in the ledger path. The AI never writes to it.**

---

## 1. Core entities

| Entity | Scope | One-line definition |
|---|---|---|
| `business_day` | outlet | The open/close ritual. Owns `business_date`. Nothing bills without one. |
| `table_session` | outlet | A party occupying one or more tables, from seating to settlement. |
| `order` | store | The running list of what a party asked for. |
| `order_item` | order | One line. Append-only. Voids are events, not deletes. |
| `kot` | outlet | A kitchen instruction. **Not a financial document.** |
| `bill` | store | A financial document. **Immutable once finalised.** |
| `payment` | bill | One tender against a bill. A bill may have many. |
| `invoice_series` | gstin+outlet | The numbering series. Issues reserved blocks to terminals. |

The four state machines below are the heart of it.

---

## 2. KOT ≠ Bill

This is the rule most clones get wrong, so it is enforced structurally rather than by convention:

| | KOT | Bill |
|---|---|---|
| Purpose | Tell the kitchen to cook | Tell the guest (and the tax authority) what is owed |
| Numbering | Per outlet, per business day, resets daily | Per **GSTIN**, per series, per **financial year**, never resets |
| Reprint | Allowed freely; increments `reprint_count`; **does not create a new KOT** | Allowed; watermarked "DUPLICATE"; does not create a new bill |
| Void | Needs reason code + manager auth; item is already cooked → wastage | Needs manager auth; creates a **credit note**; number is never reused |
| Deleted? | Never | Never |
| Lifecycle | Ends at `bumped` | Ends at `settled` |
| Relationship | An order_item is fired onto **exactly one** KOT | A bill covers **many** order_items across **many** KOTs |

They are related only through `order_item`. There is no FK from `bill` to `kot`, and there must never be one.

**The "KOT printed twice" bug** is prevented by the reprint semantics above: a reprint is a `kot_print_event` row against the *same* `kot_id`, never a new KOT. The kitchen sees one ticket with `REPRINT ×2` on it, not two tickets.

---

## 3. State machines

### 3.1 `table_session`

```
                    ┌──────────────── merge ────────────────┐
                    ▼                                       │
  (seat) ──> open ──> ordering ──> dining ──> bill_requested ──> settling ──> closed
                │         │           │              │              │
                │         └───────────┴──────────────┘              │
                │                  (transfer / move)                │
                └──> abandoned ◄─────────── force_close (day close, reason required)
                                                                    │
                          merged_into(other_session) ◄──────────────┘
```

- `open` → a table is seated, no items yet.
- `ordering` → first order_item added.
- `dining` → first KOT fired.
- `bill_requested` → guest or captain asked for the bill. **Menu is frozen for this session**; new items require an explicit un-freeze (which returns it to `dining`) so you don't get an item added after the bill was printed.
- `settling` → bill(s) finalised, payment in progress.
- `closed` → fully paid, table released.
- **`merged_into`** → this session's items and KOTs are re-parented to a target session. The source session is *not deleted*; it retains a `merged_into_session_id` pointer so audit and the floor map can explain what happened.
- **`abandoned`** → force-closed at day close with a reason (walkout, staff error). Requires manager auth. Any unsettled amount posts to a `walkout` expense line, because a day must reconcile.

**Merge / split / move:**
- **Move** — a session changes its table set. Trivial: update `table_ids`.
- **Merge** — session B merges into A. All B's orders re-parent to A. B → `merged_into`. **Guard: both sessions must be under the same store.** You cannot merge a Behrouz order into a Faasos order; they are different brands with different bills.
- **Split** — one session becomes two. Items are *reassigned*, not copied. Guard: an item that has already been fired cannot be split away from the KOT that fired it — the KOT stays with the original session and the *cost* moves. (In practice: split at billing time, which is what `split bill` §7.4 is for. Splitting a *session* mid-service is rare and we support only the un-fired case.)

### 3.2 `order_item`

Append-only. There is no `DELETE`, and `quantity` is never mutated downward.

```
  pending ──fire──> fired ──> served
     │                │
     │                └──> void_requested ──approve──> voided  (manager auth + reason + wastage)
     │                                      └─reject─> fired
     └──> voided  (free — not yet cooked, no auth needed, no wastage)
```

- A void **before** fire is free: nothing was cooked. No manager auth. No wastage. It still writes an audit row.
- A void **after** fire costs food: it requires manager auth, a reason code (`guest_changed_mind`, `wrong_item_made`, `quality_complaint`, `staff_error`), and it posts a **wastage entry** against inventory (Phase 8). This is the fraud-sensitive path and it is the one that gets tested.
- To reduce a quantity from 3 to 1, you void 2 units — as a new, negative-quantity `order_item_void` row referencing the original. The original line is never edited. This is what makes the audit log truthful.

### 3.3 `kot`

```
  queued ──> printed ──> acknowledged ──> preparing ──> ready ──> bumped
     │          │
     │          └──> print_failed ──retry──> queued
     │
     └──> voided  (all its items voided)

  bumped ──recall──> ready     (kitchen bumped by mistake; audited)
```

- `queued` → created, handed to the print bridge / pushed to KDS.
- `printed` → the print bridge ACK'd. **A KOT with no ACK after 10 s raises an alarm on the POS.** A silently failed KOT is the worst bug in the system: the guest is waiting for food nobody is cooking.
- `acknowledged` → a KDS rendered it. (Distinct from `printed`; an outlet may have both, one, or neither.)
- `bumped` → kitchen is done. `recall` un-bumps and is audited, because it is also how you'd hide a slow ticket.
- **Ticket age** is computed from `fired_at`, never from `printed_at` or `acknowledged_at`. If the printer jammed for 4 minutes, the guest still waited 4 minutes. Aging colour states on the KDS use `now() - fired_at`.

### 3.4 `bill`

```
  draft ──finalise──> finalised ──settle──> settled
    │                    │                     │
    │                    │                     ├──> refunded_partial ┐
    │                    │                     └──> refunded_full    ├─> credit_note issued
    │                    └──> voided ──────────────────────────────┘
    │                         (manager auth; number NOT reused)
    └──> discarded  (never numbered, never printed, no financial record)
```

**The invoice number is assigned at `finalise`, not at `draft`.** A draft that is abandoned burns no number. Once `finalised`:

- The bill is **immutable**. No line may be added, removed, or repriced.
- The number is **permanent**, even if the bill is later voided. A voided bill keeps its number and gets a credit note; the number is never reissued. Auditors reconcile against a continuous series, and a "missing" number is a red flag, so we never create one we can avoid.
- To change a finalised bill: void it (credit note) and issue a new one. That is the only path.

**`discarded` vs `voided`** is a real distinction. A draft the cashier abandons before printing (`discarded`) never existed financially. A printed bill that must be reversed (`voided`) generates a credit note and appears in the tax return. Conflating them is how you get either fake sales or unexplained gaps.

---

## 4. The business day

**Restaurants close at 1 AM. A bill rung at 00:47 on Sunday belongs to Saturday's trading.**

```sql
business_day (
  outlet_id, business_date date, status enum('open','closed'),
  opened_by, opened_at timestamptz, opening_float_paise bigint,
  closed_by, closed_at timestamptz,
  ...
)
create unique index one_open_day_per_outlet
  on business_days (outlet_id) where status = 'open';
```

That partial unique index is the whole enforcement mechanism for "one open day at a time." It is a database guarantee, not an application check.

**Rules:**

1. `business_date` is a `date` in **Asia/Kolkata**. It is **never derived from a timestamp on the client.** It is copied from the open `business_day` row onto every order, KOT, bill, and payment at creation time.
2. **No open day → no bill.** Enforced by FK: `bills.business_day_id → business_days.id`, plus a check that the day is `open` at insert time. This kills the entire class of orphan-bill bugs.
3. **Day Open** — manager supplies the opening cash float per terminal. The system proposes `business_date = today` (IST) and the manager confirms. Opening a day that is not today (e.g. the previous day was never closed) requires a reason.
4. **Day Close** — a checklist, all of which must pass:
   - every `table_session` is `closed`, `merged_into`, or explicitly `abandoned` with a reason;
   - every `kot` is `bumped` or `voided`;
   - every `bill` is `settled`, `voided`, or explicitly moved to a `pending_dues` ledger (credit sales);
   - each terminal's drawer is counted: **expected = opening_float + cash_sales − cash_refunds − payouts**; the manager enters **counted**; `variance = counted − expected` is recorded, and a non-zero variance requires a note.
   - Then, and only then: `status = 'closed'`, and the **daily rollup is materialised** (see [ADR-0002](adr/0002-data-retention.md) — day close is the natural aggregation boundary, and this is what makes long-range reporting cheap and archival safe).
5. **Reopening a closed day** requires `org_owner`, a reason, and an audit row. It should be almost impossible, and it is visible in the tax report.

Note the drawer is reconciled **per terminal** and rolled up **per outlet** — because a two-till outlet has two drawers (see [TENANCY.md](TENANCY.md) §2 Case C).

---

## 5. Money: the rules

1. **`bigint` paise.** Never float, never `numeric` in the app layer, never `number` in TS beyond `Number.MAX_SAFE_INTEGER` concerns (paise fits comfortably).
2. **Server-authoritative.** The client computes a bill preview for responsiveness; the server recomputes from scratch on finalise and the server's answer wins. If they disagree, the server's number is used and the discrepancy is logged as a bug — never silently accepted.
3. **Tax components are computed independently, not split.** CGST at 2.5% and SGST at 2.5% are each computed on the taxable value and each rounded half-up to the paisa. **We do not compute 5% and halve it.**

   *Why this matters:* on a taxable value of ₹1.00 (100 paise), 5% = 5 paise, but 2.5% = 2.5 paise → 3 paise each → 6 paise total. The two methods differ by a paisa. Component-wise is the legally correct one (CGST and SGST are separate levies, each appearing separately on the invoice) and it is the only method that **guarantees CGST == SGST**, which the invoice format requires. Halving can produce an unrepresentable 2.5-paise split. **Rule: compute each component at its own rate. Accept that the sum may differ by 1 paisa from `rate × taxable`.**
4. **Rounding is half-up**, at the paisa for tax components, and at the **rupee** for the bill total (`round_off` line, signed).
5. **Discount reduces the taxable value.** A discount shown on the invoice at the time of supply reduces the value of supply → tax is computed on the *post-discount* amount. (A discount given *after* the fact is a credit note, not a bill line.)
6. **Service charge is part of the value of supply and is therefore taxed**, at the rate of the principal supply. It is not a tax. ⚠️ **Legal note:** CCPA guidelines (2022) prohibit restaurants from levying service charge automatically or making it mandatory. RestroBooth models it as **off by default, opt-in per bill, one-tap removable, and logged** — never as an automatic line. The restaurant's own counsel owns this decision; our job is to make the compliant behaviour the easy one.
7. **Packaging charge** on a composite supply is taxed at the rate of the principal supply (the food), not at its own goods rate.
8. **The order of operations is fixed** and is the same everywhere:

```
  line_gross      = unit_price × qty  +  Σ(addon_price × addon_qty)
  line_taxable    = line_gross − line_discount
  ────────────────────────────────────────────────────────────────
  subtotal        = Σ line_taxable
  bill_discount   = flat or % of subtotal, then allocated back to lines
                    pro-rata by line_taxable (largest-remainder, so it sums exactly)
  charges         = service_charge + packaging          (each mapped to a tax class)
  ────────────────────────────────────────────────────────────────
  for each tax_class present:
      class_taxable = Σ (post-discount line_taxable of that class) + charges of that class
      cgst = round_half_up(class_taxable × cgst_rate)      -- intra-state
      sgst = round_half_up(class_taxable × sgst_rate)      -- intra-state
      igst = round_half_up(class_taxable × igst_rate)      -- inter-state (mutually exclusive)
  ────────────────────────────────────────────────────────────────
  tax_total       = Σ all components
  gross           = subtotal − bill_discount + charges + tax_total
  round_off       = round_to_rupee(gross) − gross          -- signed, in paise
  payable         = gross + round_off                      -- invariant: payable % 100 == 0
```

**A bill-level discount is allocated back down to the lines** before tax, because different lines may carry different tax rates and the discount must reduce each class's taxable value proportionally. Allocating by largest-remainder guarantees `Σ allocated == bill_discount` exactly, with no lost paisa.

---

## 6. Invoice numbering

### 6.1 The legal constraint

CGST Rule 46(b): a consecutive serial number, **not exceeding sixteen characters**, in **one or multiple series**, containing alphabets, numerals, hyphen `-` and slash `/`, **unique for a financial year**.

Three things follow, and the third one is the escape hatch that makes offline billing legal:

- **16 characters is a hard ceiling.** It is tighter than it looks and it constrains the format. A DB `check` constraint and a unit test enforce it.
- **Financial year is April–March**, not calendar year. `FY(2026-07-13) = '2627'`. A bill on 2027-03-31 is FY 2627; a bill on 2027-04-01 is FY 2728 and the sequence **resets to 1**.
- **Multiple series are explicitly permitted.** This is what lets an offline terminal fall back to its own series without breaking the law.

### 6.2 The series key

```
invoice_series (gst_registration_id, outlet_id, series_code, financial_year) → next_seq
```

**Scoped to the GSTIN**, not the org and not the outlet alone — an org with two GSTINs runs two independent numbering universes, and that is a legal requirement, not a design preference.

Format: `{SERIES}/{FY}/{SEQ}`

| Series | Example | Length | Use |
|---|---|---|---|
| Outlet default | `A1/2627/000123` | 14 | Normal billing. All terminals draw blocks from this. |
| Terminal offline fallback | `A1T2/2627/00123` | 15 | Only if a terminal exhausts its block while offline. |
| Credit note | `A1CN/2627/00042` | 15 | Separate series (credit notes have their own numbering requirement). |

Validation, enforced in the DB and in `packages/domain`:
```
length(invoice_no) <= 16  AND  invoice_no ~ '^[A-Za-z0-9/-]+$'
```

### 6.3 Reserved blocks for offline terminals

A terminal cannot ask the server for a number when the server is unreachable, so it must already hold some.

- On provisioning (and thereafter), a terminal is issued a **contiguous block** `[start_seq, end_seq]` from its outlet's series. Blocks are allocated server-side under a row lock, so two terminals can never receive overlapping ranges.
- **Block size** = 3 × the terminal's p95 daily bill count (default **300**). Sized so that a full day offline cannot exhaust it.
- **Low-watermark top-up:** when remaining < 30%, the terminal requests the next block *while it still has connectivity*. This is the mechanism that makes exhaustion nearly impossible in practice.
- **If a block does exhaust while offline** — the terminal switches to its **dedicated offline series** (`A1T2/...`), which is pre-allocated at provisioning and needs no server round-trip. Legal, because multiple series are permitted.
- **We never** (a) refuse to bill, or (b) print a provisional number and renumber it on sync. **A printed invoice number is immutable the instant it leaves the building** — the guest is holding it. Renumbering on sync is the single most tempting and most illegal shortcut available here, and it is forbidden.

### 6.4 Gaps

Blocks create gaps: terminal T1 holds 101–200, bills only 137 of them, and the day ends. 138–200 are never used.

**Gaps are permitted, permanent, and must be explained.** Auditors ask about gaps; "our POS just does that" is not an answer.

```sql
invoice_number_gap (
  gst_registration_id, outlet_id, series_code, financial_year,
  from_seq, to_seq,
  reason enum('block_returned_unused','terminal_decommissioned',
              'block_lost_device_failure','fy_rollover'),
  recorded_by, recorded_at, note
)
```

- A block is **returned** at day close: the unused tail is written to the gap register with `block_returned_unused`, and the block is closed.
- **Numbers are never reused.** Reissuing 138–200 to another terminal risks a collision if T1 comes back online holding an unsynced bill numbered 139. Correctness beats tidiness.
- The **Gap Register report** (Phase 9, tax reports) lists every gap per GSTIN per FY with its reason. This is a compliance feature, and it exists precisely so that the answer to the auditor's question is a printout.

---

## 7. Worked examples

All amounts in paise. All of these become test fixtures.

### 7.1 Two tax classes on one bill

Outlet: Ahmedabad (Gujarat). GSTIN `24…`. Intra-state → CGST + SGST.

| Line | Qty | Unit | Gross | Tax class |
|---|---|---|---|---|
| Butter Chicken | 2 | 38 000 | **76 000** | `FOOD_5` (5%) |
| Packaged water 1 L | 2 | 2 000 | **4 000** | `GOODS_18` (18%) |

```
subtotal                     = 76 000 + 4 000        = 80 000
FOOD_5    taxable 76 000 →  CGST 2.5% = 1 900 ;  SGST 2.5% = 1 900   → 3 800
GOODS_18  taxable  4 000 →  CGST   9% =   360 ;  SGST   9% =   360   →   720
tax_total                    = 3 800 + 720           =  4 520
gross                        = 80 000 + 4 520        = 84 520      (₹845.20)
round_off  round_to_rupee(84 520) = 84 500           =    −20
payable                                              = 84 500      (₹845.00)  ✓ payable % 100 == 0
```

> The tax class is a **per-item attribute**, and which class an item belongs to is the restaurant's CA's call, not ours (whether bottled water served with a meal is a composite supply at 5% or a separate supply of goods at 18% has gone both ways at the AAR). **RestroBooth's job is to make the class configurable and the arithmetic exact — not to decide GST law.**

### 7.2 Item-level discount (shows component rounding)

| Line | Qty | Unit | Gross | Discount | Taxable |
|---|---|---|---|---|---|
| Paneer Tikka | 3 | 28 500 | 85 500 | 15% = **12 825** | **72 675** |

```
subtotal                = 72 675
FOOD_5:  CGST = round_half_up(72 675 × 0.025) = round(1 816.875) = 1 817
         SGST = round_half_up(72 675 × 0.025) = round(1 816.875) = 1 817
tax_total               = 3 634
gross                   = 72 675 + 3 634 = 76 309                 (₹763.09)
round_off                                = −9
payable                                  = 76 300                 (₹763.00)
```

Note `1 817 + 1 817 = 3 634`, whereas `round(72 675 × 0.05) = round(3 633.75) = 3 634`. They agree here. On a taxable value of 100 paise they would not (6 vs 5), which is why the rule is fixed at component-wise. **Test both.**

### 7.3 Service charge, and a round-**up**

```
food subtotal (FOOD_5)                       = 100 000        (₹1 000.00)
service charge 10%, opt-in, FOOD_5 class     =  10 000        (₹  100.00)
class_taxable = 100 000 + 10 000             = 110 000    ← service charge IS taxed
  CGST 2.5% = 2 750 ;  SGST 2.5% = 2 750
tax_total                                    =   5 500
gross                                        = 115 500        (₹1 155.00)
round_off                                    =       0
payable                                      = 115 500
```

A round-up case, to pin the half-up rule: gross `84 560` → `round_to_rupee` → `84 600`, so **`round_off = +40`**. And exactly on the boundary: gross `84 550` → `84 600`, `round_off = +50` (half rounds **up**).

### 7.4 Split by guest

**First, a distinction the brief conflates, and it matters:**

- **Split *tender*** — one bill, one invoice number, several payment methods. `Σ payments == bill.payable` exactly. Trivial.
- **Split *bill*** — **N separate GST invoices, N invoice numbers, N separate documents.** Each is computed and rounded independently *from its own line set*. Their totals need **not** sum to the total of a hypothetical un-split bill — and that is correct, **because the un-split bill was never issued.** There is no document it has to reconcile to.

The invariant that *does* hold, and that we enforce:

> **Σ (split taxable values) == order subtotal, exactly.** Every item is allocated to exactly one split; shared items are divided by largest-remainder so no paisa is created or destroyed.

Table of 3 (seats S1, S2, S3), all `FOOD_5`, Ahmedabad:

| Item | Amount | Assigned to |
|---|---|---|
| Butter Chicken ×1 | 38 000 | shared S1, S2, S3 |
| Paneer Tikka ×1 | 28 500 | S1 |
| Naan ×4 | 24 000 | shared S1, S2, S3 |
| Coke ×2 | 24 000 | S2 (12 000), S3 (12 000) |
| **subtotal** | **114 500** | |

Shared pool = 38 000 + 24 000 = **62 000**, split three ways:
`62 000 / 3 = 20 666 remainder 2` → largest-remainder by seat order → **S1: 20 667, S2: 20 667, S3: 20 666**  (Σ = 62 000 ✓)

| | S1 | S2 | S3 | Σ |
|---|---|---|---|---|
| taxable | 20 667 + 28 500 = **49 167** | 20 667 + 12 000 = **32 667** | 20 666 + 12 000 = **32 666** | **114 500** ✓ |
| CGST 2.5% | 1 229 | 817 | 817 | |
| SGST 2.5% | 1 229 | 817 | 817 | |
| gross | 51 625 | 34 301 | 34 300 | |
| round_off | −25 | −1 | 0 | |
| **payable** | **51 600** | **34 300** | **34 300** | **120 200** |
| **invoice no** | `A1/2627/000124` | `A1/2627/000125` | `A1/2627/000126` | 3 numbers |

*(S1's CGST: 49 167 × 0.025 = 1 229.175 → 1 229. S2: 32 667 × 0.025 = 816.675 → 817. S3: 32 666 × 0.025 = 816.65 → 817.)*

For reference, a single un-split bill on the same order would be: taxable 114 500, CGST 2 863, SGST 2 863, gross 120 226, round_off −26, **payable 120 200**. It happens to match here. **It is not guaranteed to, and the code must not assert that it does** — three independent round-offs can drift a few paise from one. That is not a bug; those three invoices are the only documents that exist.

Split by **item** and split by **amount** are the same machinery: split-by-item assigns whole lines; split-by-amount allocates the *payable* by largest-remainder and issues one invoice per share.

### 7.5 Inter-state central-kitchen transfer (IGST) — and the tax that isn't recoverable

Central kitchen: **Ahmedabad, Gujarat**, GSTIN `24AAAAA0000A1Z5`.
Receiving outlet: **Mumbai, Maharashtra**, GSTIN `27AAAAA0000A1Z8`.
Same org, same PAN, **different GSTINs → "distinct persons" under GST §25(4) → the transfer IS a taxable supply.**

Transfer: 20 kg *Makhani Gravy Base* (a semi-finished good with its own recipe and its own cost). Production cost **₹180.00/kg = 18 000 paise/kg**.

```
cost                     = 20 × 18 000                 = 360 000     (₹3 600.00)
valuation (Rule 30: 110% of cost, no open market value) = 396 000    (₹3 960.00)
inter-state → IGST @ 5%  = round_half_up(396 000 × 0.05) = 19 800    (₹  198.00)
invoice total                                          = 415 800     (₹4 158.00)
document                 : TAX INVOICE, numbered from the GUJARAT GSTIN's series
e-way bill               : consignment value ₹4 158 < ₹50 000 → not required
```

**Now the part that is a business fact, not just an accounting one.** A restaurant paying GST at 5% on its food supply is **not eligible for input tax credit**. So the Mumbai outlet **cannot reclaim that ₹198.** It is a real, unrecoverable cost, and it lands in Mumbai's food cost and not in Ahmedabad's.

Two consequences worth putting in front of an owner:

1. **The same dish genuinely costs more at an out-of-state outlet**, purely because of the transfer tax — before you even count vendor price differences. This is a first-class input to the Phase 8 food-cost report and the Phase 9 network benchmark, and it is a much better answer than "vendor prices differ."
2. **It is an argument for locating a central kitchen in the same state as the outlets it serves.** RestroBooth should be able to *tell* an owner that. That is a feature.

**Contrast — the same transfer, intra-state:** Ahmedabad CK → Ahmedabad outlet, both under GSTIN `24…`. Same legal person → **not a supply.** **Delivery challan only. No tax. No invoice number consumed.** Stock moves at cost: **360 000 paise**.

That one contrast is the entire reason `gst_registration` must exist in the Phase 1 schema even though central kitchen does not ship until Phase 8.

---

## 8. Offline conflict rules — **per entity**

> ## ⏸ PARKED — 2026-07-13. Not approved. Decision deferred.
>
> **Offline-first billing remains fully in scope and still ships in Phase 3b.** What is deferred is *sign-off on the table below*, not the feature.
>
> **This must be approved before Phase 3b begins.** It is not optional and it cannot be discovered during implementation: the conflict rule for each entity determines its *schema* (append-only vs. mutable), and getting that wrong is a migration, not a patch. Phases 1, 2, 3a and 4 do not depend on it and can proceed.
>
> **Nothing else in this document is blocked by it.** Everything above (§1–§7) is approved.

**The brief asks:** last-write-wins, or server-rejects-with-replay? The answer is *neither, globally* — it is per entity, and the answer for `order_items` is emphatically not the answer for `table_session`.

The governing principles:

- **Never lose an order.** A dropped item means a guest doesn't get food. That outranks tidiness.
- **Never duplicate money.** A duplicate bill is worse than a rejected one.
- **Prefer under-selling to over-selling.** If two people disagree about stock, believe the pessimist.
- **Every mutation carries a client-generated idempotency key** (UUIDv7 from the terminal). Replay is always safe. This is the foundation the whole table rests on.

| Entity | Rule | Why — and what goes wrong with the alternative |
|---|---|---|
| `order_item` (add) | **Append-only, server-authoritative merge.** Dedup on `(order_id, client_line_id)`. Two terminals adding items to the same order both win; nothing is overwritten. | **LWW is catastrophic here.** Captain A adds 2 naan offline, Captain B adds a dessert online. Under LWW one of them vanishes and a guest doesn't get food. Never LWW. |
| `order_item` (void) | **Append-only event**, not a delete. Void of an already-voided line is idempotent (no-op). | Voids and adds commute, so replay order doesn't matter. |
| `order` (status) | **Server applies the state machine.** An illegal transition (e.g. offline terminal tries `billed → open`) is **rejected and surfaced to the user** as a conflict — never auto-resolved. | Auto-resolving a state conflict silently is how a settled order gets reopened. |
| `table_session` (**open**) | **Auto-merge.** If a session already exists on the server for that table, the offline session's items are merged into it; the offline session id is retained as an alias. | Two captains both seat table 7 while the link is flaky. Rejecting one **loses its orders**. Merging loses nothing. Violates "never lose an order" to do otherwise. |
| `table_session` (**close / settle**) | **Server rejects with replay.** Occupancy and settlement are single-writer facts. On conflict, the terminal re-fetches and the user re-decides. | LWW here is *exactly* the bug in the brief's opening paragraph: **"a table that shows occupied after the guests left."** A stale offline `close` must not resurrect or re-close a table. |
| `bill` (finalise) | **Immutable. Number drawn from the terminal's reserved block. Replayed as-is, never renumbered.** Dedup strictly on idempotency key. | The guest is holding a printed invoice. Its number is final. Renumbering on sync is illegal. |
| `bill` (duplicate detected) | If a *different* bill already exists for the same session/lines: **flag for manager, do not auto-resolve.** | This is money. A human decides. Auto-merging bills is how you make a fake sale disappear. |
| `payment` | **Idempotency key, at-most-once.** Replay is a no-op. Gateway callbacks are also idempotent on `(gateway, gateway_txn_id)`. | Double-charging a guest is unrecoverable reputationally. |
| `item availability` (86) | **LWW on server-received time — asymmetric: `unavailable` beats `available` inside a 60 s window.** | Cheap to be wrong in the safe direction. Selling a dish you don't have costs a guest; failing to sell one you do costs a plate. Believe the pessimist. |
| `menu`, `price`, `overrides` | **Read-only on terminals. Never written offline.** Terminals cache the resolved menu and refresh on reconnect. | No conflict is possible, by construction. This is the payoff of "a cashier never changes a price." |
| `business_day` (open/close) | **Server-authoritative, single writer per `(outlet, business_date)`** (the partial unique index). An offline day-close is **queued and may be rejected**. | Two terminals closing the day would double-count the drawer. |
| `kot` (fire) | **Append-only, idempotent on client key.** A KOT fired offline prints locally *and* syncs. | Duplicate KOT = duplicate food = real cost. The idempotency key is what prevents the "KOT printed twice" bug across a reconnect. |
| `kot` (bump) | **LWW.** Bumping a bumped ticket is a no-op. | Harmless and idempotent either way. |
| `stock` / inventory | **Never authoritative offline.** Deduction happens server-side on bill settle, on replay. | Offline stock math across N terminals cannot converge. Don't try. |

### The reconnect sequence

```
1. Terminal replays its outbox in causal order, oldest first.
   Every request carries its idempotency key.
2. Server applies each mutation through the rules above.
3. Server returns, per mutation: applied | duplicate_ignored | rejected(reason).
4. Terminal reconciles: anything `rejected` is surfaced to the human. Nothing
   is silently dropped, and nothing is silently retried forever.
5. Terminal pulls the authoritative state for its outlet and replaces its
   local cache. The server's state wins for everything except the append-only
   entities, which have already merged.
```

**The acceptance test for all of this** (Phase 3b gate): kill the network mid-service, bill four tables, reconnect **twice** with an interleaved reconnect from a second terminal, and assert **zero duplicate bills, zero lost order items, zero duplicate KOTs, and no gap in the invoice series that isn't in the gap register.**
