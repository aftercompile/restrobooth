# ADR-0002 — Data retention, partitioning, and archival

**Status:** Accepted
**Date:** 2026-07-13

## Context

20 outlets × 300 orders/day × ~4 lines ≈ **48 M rows/year** across `orders`, `order_items`, `kots`, `bills`, and `order_status_events` ([ERD.md](../ERD.md) §6). Supabase Free caps the DB at 500 MB; Pro gives 8 GB then bills $0.125/GB.

The naive outcome is a database that grows without bound, reports that get slower every month, and a Phase 10 emergency. The brief is right to demand this decision at Phase 0.

Two constraints pull in opposite directions:
- **Tax and audit data must be retained for years** (GST records: 72 months from the annual-return due date). It cannot be deleted.
- **Operational event data is worthless after a month** and is the highest-volume thing we produce.

## Decision

**Monthly range partitioning on `business_date`, a short hot window, and rollups materialised at day close.**

### 1. Partition by `business_date`, monthly

Not by `created_at`. `business_date` is the domain's own time axis (a bill rung at 00:47 belongs to yesterday), so partitioning on it means a partition boundary never splits a trading day. Partition key is in the PK: `primary key (id, business_date)`.

Partitions are created **three months ahead** by a scheduled job. **A missing partition is an outage** — inserts fail — so the job alarms loudly, and CI asserts against staging that the next three months exist.

### 2. Hot windows, by value not by volume

| Table | Hot window | Rationale |
|---|---|---|
| `order_status_events` | **1 month** | Highest volume (~22 M/yr), lowest value. Genuinely disposable. |
| `orders`, `order_items`, `kots` | **3 months** | Covers "compare to last quarter" operationally. |
| `bills`, `bill_tax_lines`, `payments` | **13 months** | Tax. A full FY plus one month of overlap, so a March audit never touches cold storage. |
| audit tables (`menu_audit_log`, `bill_void_audit`, `invoice_number_gaps`) | **forever** | Never partitioned, never archived. They are small and they are the thing an auditor asks for. |

### 3. The load-bearing idea: **day close materialises the rollups**

Because the domain has an explicit Day Close ritual ([DOMAIN.md](../DOMAIN.md) §4), there is a natural, exact, once-per-day aggregation boundary. At close, per outlet, we write:

- `daily_sales_summary` — covers, gross, net, discounts, tax by class, tender mix, by channel, by hour
- `daily_item_summary` — qty, gross, discount, cost, margin per item per store
- `daily_tax_summary` — per GSTIN per class (this is the GST return input)
- `daily_staff_summary` — per user: bills, voids, discounts (the discount-audit report)

**Every report older than the hot window reads rollups only, and never touches a raw partition.** That is what makes archival free: we are not trading analytics away to save space, because the analytics never needed the raw rows.

Rollup rows: ~200/outlet/day → 20 outlets × 365 ≈ **1.5 M rows/year, a few hundred MB, kept forever.** Compare to 48 M raw rows/year. The Phase 9 report suite and the Phase 9 network benchmark both read this layer, which also makes them fast enough to be interactive.

Day close is idempotent and re-runnable: reopening a day (org_owner + reason) invalidates and recomputes its rollups.

### 4. Cold storage

Partitions past the hot window are **exported to Parquet in object storage and detached** — not dropped.

- Financial/legal partitions are **retained for 8 years** and can be re-attached to the live DB if an auditor asks. Re-attach is a documented, rehearsed runbook, not an improvisation.
- `order_status_events` partitions are **dropped** after export. Nobody has ever asked for a 14-month-old KDS state transition.

Cost: Parquet compresses this shape roughly 10:1. A year of cold data is a couple of GB — cents per month in object storage. **The archival tier costs approximately nothing; the point of the exercise is to keep the hot Postgres database small enough to be fast and cheap.**

## Consequences

- **Positive:** the live database size is bounded by the hot window, not by the age of the business. A 5-year-old, 20-outlet chain has the same hot-DB footprint as a 1-year-old one. Postgres stays on the small Supabase tiers essentially forever.
- **Positive:** reports get *faster* as the rollup layer takes over, rather than slower.
- **Negative:** two query paths (hot raw / cold rollup) is a real complexity cost. Mitigation: **the report layer never queries raw tables directly.** It reads rollups, always, even for today (today's rollup is computed on the fly for the open day). One path, not two, at the API level.
- **Negative:** partitioned tables complicate FKs. Postgres 12+ supports FKs *referencing* partitioned tables, but cross-partition FKs between two partitioned tables need care and must be tested in Phase 1, not assumed.
- **Risk:** a bug in the day-close rollup silently corrupts all historical reporting. Mitigation: rollups are **recomputable from the raw partition while it is hot**, and a nightly job re-derives the last 7 days' rollups and asserts they match. A drift alarm is a P1.
