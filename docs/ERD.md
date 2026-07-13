# RestroBooth — Schema

**Status:** Phase 0 draft, pending approval
**Last updated:** 2026-07-13

Written as Postgres DDL sketch, not Drizzle, because the constraints are the point and Drizzle is a transcription detail. Phase 1 writes the migration; nothing here is created by hand. Types are indicative; the **constraints and indexes are the deliverable**.

All money is `bigint` paise. All timestamps are `timestamptz`. All ids are `uuid` (v7 client-side where offline generation is needed, so they sort by creation time).

---

## 1. Tenancy

```sql
create table organizations (
  id uuid primary key,
  legal_name    text not null,
  pan           char(10),                       -- one PAN per legal entity
  created_at    timestamptz not null default now()
);

create table gst_registrations (
  id uuid primary key,
  org_id        uuid not null references organizations,
  gstin         char(15) not null,
  state_code    char(2)  not null,              -- first 2 chars of GSTIN
  legal_name    text not null,
  trade_name    text,
  constraint gstin_format check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$'),
  constraint gstin_state_matches check (state_code = substring(gstin from 1 for 2)),
  unique (gstin),
  unique (org_id, state_code)                   -- ONE GSTIN PER STATE PER ENTITY
);

create table brands (
  id uuid primary key,
  org_id        uuid not null references organizations,
  name          text not null,
  slug          text not null unique
);

create table outlets (                          -- A PLACE
  id uuid primary key,
  org_id                uuid not null references organizations,
  gst_registration_id   uuid not null references gst_registrations,
  name          text not null,
  code          char(3) not null,               -- used in invoice series, e.g. 'AMD'
  timezone      text not null default 'Asia/Kolkata',
  address       jsonb not null,
  kind          text not null default 'restaurant'
                check (kind in ('restaurant','cloud_kitchen','central_kitchen','warehouse')),
  unique (org_id, code)
);
-- INVARIANT: an outlet's GSTIN must be registered in the outlet's state.
-- Enforced by trigger comparing address->>'state_code' to gst_registrations.state_code.

create table stores (                           -- A BRAND SELLING AT A PLACE
  id uuid primary key,
  brand_id      uuid not null references brands,
  outlet_id     uuid not null references outlets,
  status        text not null default 'active' check (status in ('active','paused','closed')),
  unique (brand_id, outlet_id)                  -- exactly one store per (brand, outlet)
);

create table areas (                            -- floor-plan grouping only; NOT tenancy
  id uuid primary key,
  outlet_id     uuid not null references outlets,
  name          text not null,                  -- 'Ground', 'Rooftop', 'Garden'
  default_kot_route_id uuid                     -- how a rooftop bar prints at the bar station
);

create table terminals (
  id uuid primary key,
  outlet_id     uuid not null references outlets,
  code          char(2) not null,               -- 'T1', used in the offline invoice series
  name          text not null,
  unique (outlet_id, code)
);

create table outlet_groups (                    -- arbitrary bag: clusters, pilot cohorts
  id uuid primary key,
  org_id        uuid not null references organizations,
  name          text not null
);
create table outlet_group_members (
  outlet_group_id uuid not null references outlet_groups,
  outlet_id       uuid not null references outlets,
  primary key (outlet_group_id, outlet_id)
);
```

## 2. Access

```sql
create table memberships (
  id uuid primary key,
  user_id     uuid not null references auth.users,
  scope_type  text not null check (scope_type in ('org','brand','outlet_group','outlet')),
  scope_id    uuid not null,                    -- polymorphic; validated by trigger per scope_type
  role        text not null check (role in ('org_owner','brand_manager','cluster_manager',
                                            'outlet_manager','cashier','captain','kitchen')),
  created_at  timestamptz not null default now(),
  unique (user_id, scope_type, scope_id, role)
);
create index on memberships (user_id);          -- the hot path: every query hits this
```

**The access function.** Note it takes **no argument** — a `SECURITY DEFINER` function that resolves an arbitrary user's outlets is an information-disclosure oracle (see [TENANCY.md](TENANCY.md) §6, case A15).

```sql
create function accessible_outlet_ids()
  returns setof uuid
  language sql
  stable                                        -- lets the planner hoist it to an InitPlan
  security definer
  set search_path = public
as $$
  select o.id from outlets o
  join memberships m on m.user_id = (select auth.uid())
  where (m.scope_type = 'org'          and m.scope_id = o.org_id)
     or (m.scope_type = 'outlet'       and m.scope_id = o.id)
     or (m.scope_type = 'outlet_group' and m.scope_id in (
           select outlet_group_id from outlet_group_members where outlet_id = o.id))
     or (m.scope_type = 'brand'        and m.scope_id in (
           select brand_id from stores where outlet_id = o.id));
$$;
revoke execute on function accessible_outlet_ids() from public;
grant   execute on function accessible_outlet_ids() to authenticated;
```

Policy shape, on **every** outlet-scoped table:

```sql
create policy outlet_isolation on <table> for all
  using ( outlet_id in (select accessible_outlet_ids()) );
```

The `(select …)` wrapper is **mandatory**, not stylistic: it makes Postgres evaluate the function **once per statement** instead of **once per row**. Without it, a scan of a 9M-row partition calls it 9M times. This is the single most common way a Supabase RLS deployment falls over, and whether even the hoisted form is fast enough is **BENCH-01** ([BENCHMARKS.md](BENCHMARKS.md)).

**Store-scoped tables need a second predicate** so a brand manager in a shared cloud kitchen cannot read a sibling brand's orders (test case A8):

```sql
create policy store_isolation on orders for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())   -- intersects outlet-access with brand-access
  );
```

## 3. Menu

```sql
create table tax_classes (
  id uuid primary key,
  org_id     uuid not null references organizations,
  code       text not null,                     -- 'FOOD_5', 'GOODS_18'
  rate_bps   int  not null,                     -- basis points: 500 = 5%, 1800 = 18%
  unique (org_id, code)
);

create table menu_items (                       -- DEFINED ONCE, AT BRAND LEVEL
  id uuid primary key,
  brand_id       uuid not null references brands,
  name           text not null,
  description    text,
  base_price_paise bigint not null check (base_price_paise >= 0),
  tax_class_id   uuid not null references tax_classes,
  diet           text check (diet in ('veg','non_veg','egg','jain')),
  allergens      text[] not null default '{}',
  embedding      vector(384),                   -- gte-small, for the Booth Host
  status         text not null default 'draft'
                 check (status in ('draft','published','archived'))
);

create table menu_item_overrides (              -- SPARSE. Never a duplicated menu.
  id uuid primary key,
  menu_item_id   uuid not null references menu_items,
  store_id       uuid     references stores,    -- dimension S   (weight 1)
  channel_code   text,                          -- dimension C   (weight 2)
  daypart_id     uuid     references dayparts,  -- dimension D   (weight 4)
  promo_id       uuid     references promos,    -- dimension P   (weight 8)
  price_paise    bigint check (price_paise >= 0),   -- null = don't override price
  is_available   boolean,                           -- null = don't override availability
  effective_from timestamptz not null,
  effective_to   timestamptz,
  status         text not null default 'draft'
                 check (status in ('draft','pending_approval','approved','published')),
  publish_batch_id uuid,                        -- staged rollout: roll back as a unit
  published_at   timestamptz,

  -- binary specificity: reproduces brand→store→channel→daypart→promo as a TOTAL order
  specificity int generated always as (
      (case when promo_id   is not null then 8 else 0 end)
    + (case when daypart_id is not null then 4 else 0 end)
    + (case when channel_code is not null then 2 else 0 end)
    + (case when store_id   is not null then 1 else 0 end)
  ) stored,

  -- an all-null override row is meaningless
  constraint overrides_something check (price_paise is not null or is_available is not null),
  constraint sane_dates check (effective_to is null or effective_to > effective_from)
);

create index on menu_item_overrides (menu_item_id, status, specificity desc)
  where status = 'published';
create index on menu_item_overrides (store_id, channel_code) where status = 'published';
```

`variants` and `addon_groups` (with `min_select` / `max_select`) hang off `menu_items` conventionally and are omitted here for brevity — they carry no novel constraint.

**Resolution is a single SQL function**, `resolve_menu(store_id, channel, at timestamptz)`, returning `(item_id, price_paise, is_available)`. `price` and `is_available` resolve **independently** — each takes the highest-specificity row where *that field* is non-null. See [TENANCY.md](TENANCY.md) §7.4 rows 17–18, which exist precisely to catch the bug where an 86 wipes out a price override. Live vs. materialised: [ADR-0006](adr/0006-override-resolution.md), pending **BENCH-02**.

## 4. Operations — the partitioned tables

```sql
create table business_days (
  id uuid primary key,
  outlet_id      uuid not null references outlets,
  business_date  date not null,
  status         text not null check (status in ('open','closed')),
  opened_by uuid, opened_at timestamptz,
  closed_by uuid, closed_at timestamptz,
  unique (outlet_id, business_date)
);
create unique index one_open_day_per_outlet
  on business_days (outlet_id) where status = 'open';   -- THE enforcement mechanism
```

```sql
create table orders (
  id             uuid not null,
  business_date  date not null,                 -- partition key
  outlet_id      uuid not null references outlets,
  store_id       uuid not null references stores,
  business_day_id uuid not null references business_days,
  table_session_id uuid references table_sessions,
  channel_code   text not null default 'dinein',
  status         text not null check (status in ('open','billed','settled','voided','cancelled')),
  idempotency_key uuid not null,
  created_at     timestamptz not null default now(),
  primary key (id, business_date)               -- partition key MUST be in the PK
) partition by range (business_date);

create unique index on orders (idempotency_key);   -- replay safety, globally
```

Same shape for `order_items`, `kots`, `kot_items`, `bills`, `payments`, `order_status_events` — all partitioned by `business_date`, monthly. Partitions are created **three months ahead** by a scheduled job; a missing partition is an outage, so the job alarms loudly and the check runs in CI against staging.

```sql
create table bills (
  id             uuid not null,
  business_date  date not null,
  outlet_id      uuid not null,
  store_id       uuid not null,
  gst_registration_id uuid not null references gst_registrations,
  terminal_id    uuid not null references terminals,
  invoice_no     text,                          -- NULL while draft; assigned at finalise
  status         text not null check (status in
                   ('draft','finalised','settled','voided','refunded_partial','refunded_full','discarded')),

  subtotal_paise      bigint not null,
  discount_paise      bigint not null default 0,
  charges_paise       bigint not null default 0,
  tax_paise           bigint not null default 0,
  round_off_paise     bigint not null default 0,   -- SIGNED
  payable_paise       bigint not null,

  idempotency_key uuid not null,
  finalised_at   timestamptz,
  primary key (id, business_date),

  constraint invoice_no_legal check (
    invoice_no is null
    or (length(invoice_no) <= 16 and invoice_no ~ '^[A-Za-z0-9/-]+$')   -- CGST Rule 46(b)
  ),
  constraint numbered_iff_finalised check (
    (status = 'draft' and invoice_no is null) or
    (status = 'discarded' and invoice_no is null) or
    (status not in ('draft','discarded') and invoice_no is not null)
  ),
  constraint payable_is_whole_rupees check (payable_paise % 100 = 0),
  constraint totals_reconcile check (
    payable_paise = subtotal_paise - discount_paise + charges_paise + tax_paise + round_off_paise
  )
) partition by range (business_date);

create unique index on bills (idempotency_key);
```

Those last three check constraints are the ones that matter. `totals_reconcile` and `payable_is_whole_rupees` make an incorrectly-computed bill **impossible to persist** — the money math is guarded by the database, not merely by tests. `numbered_iff_finalised` makes an unnumbered finalised bill impossible.

**Tax is stored per component, per class, on its own table** — the invoice must show CGST and SGST separately, and a bill may have several tax classes:

```sql
create table bill_tax_lines (
  bill_id uuid not null, business_date date not null,
  tax_class_id uuid not null references tax_classes,
  component text not null check (component in ('cgst','sgst','igst','cess')),
  taxable_paise bigint not null,
  rate_bps int not null,
  amount_paise  bigint not null,
  primary key (bill_id, business_date, tax_class_id, component)
) partition by range (business_date);
```

## 5. Invoice numbering

```sql
create table invoice_series (
  id uuid primary key,
  gst_registration_id uuid not null references gst_registrations,
  outlet_id      uuid not null references outlets,
  series_code    text not null,                 -- 'A1', 'A1T2', 'A1CN'
  financial_year char(4) not null,              -- '2627' = FY Apr 2026 – Mar 2027
  next_seq       bigint not null default 1,
  unique (gst_registration_id, outlet_id, series_code, financial_year)
);

create table invoice_number_blocks (            -- reserved ranges for offline terminals
  id uuid primary key,
  invoice_series_id uuid not null references invoice_series,
  terminal_id    uuid not null references terminals,
  start_seq      bigint not null,
  end_seq        bigint not null,
  next_seq       bigint not null,               -- terminal's local cursor
  status         text not null check (status in ('active','exhausted','returned')),
  issued_at      timestamptz not null default now(),
  check (end_seq >= start_seq and next_seq between start_seq and end_seq + 1),
  exclude using gist (                          -- BLOCKS CAN NEVER OVERLAP
    invoice_series_id with =,
    int8range(start_seq, end_seq, '[]') with &&
  )
);

create table invoice_number_gaps (              -- auditors ask. This is the answer.
  id uuid primary key,
  invoice_series_id uuid not null references invoice_series,
  from_seq bigint not null, to_seq bigint not null,
  reason text not null check (reason in
    ('block_returned_unused','terminal_decommissioned','block_lost_device_failure','fy_rollover')),
  recorded_by uuid, recorded_at timestamptz not null default now(), note text
);
```

The `exclude using gist` constraint is the important one: **two terminals can never be issued overlapping number ranges**, and that is enforced by Postgres rather than by careful application code. It is the structural guarantee behind "no duplicate invoice numbers, ever, even offline."

## 6. Partitioning and retention

| Table | Partitioned by | Interval | Hot window |
|---|---|---|---|
| `orders`, `order_items` | `business_date` | monthly | 3 months |
| `bills`, `bill_tax_lines`, `payments` | `business_date` | monthly | **13 months** (tax: full FY + 1) |
| `kots`, `kot_items` | `business_date` | monthly | 3 months |
| `order_status_events` | `business_date` | monthly | **1 month** (highest volume, lowest value) |
| `menu_audit_log`, `invoice_number_gaps`, `bill_void_audit` | — | never partitioned, never archived | forever |

**The row arithmetic** (20 outlets, 300 orders/day, ~4 lines):

| Table | Rows/day | Rows/year |
|---|---|---|
| `orders` | 6 000 | 2.2 M |
| `order_items` | 24 000 | 8.8 M |
| `kots` + `kot_items` | ~30 000 | 11 M |
| `order_status_events` | ~60 000 | 22 M |
| `bills` + `bill_tax_lines` | ~12 000 | 4.4 M |
| **Total** | **~132 000** | **~48 M** |

~48M rows/year at 20 outlets. **Supabase Free caps the database at 500 MB** — this exceeds it inside the first month. See [ADR-0001](adr/0001-hosting.md) and [ADR-0002](adr/0002-data-retention.md).

**Day close materialises the rollups.** This is the load-bearing idea of the retention strategy: because the business day has an explicit close ritual, there is a natural, exact aggregation boundary. At close we write `daily_sales_summary`, `daily_item_summary`, `daily_tax_summary`, `daily_staff_summary` per outlet. **Every report older than the hot window reads only rollups** and never touches a cold partition — so archiving raw rows costs us nothing analytically.

Financial/legal tables (`bills`, `bill_tax_lines`, `payments`, and every audit table) are **never destroyed** — cold partitions are exported to Parquet in object storage and detached, and can be re-attached if an auditor asks. `order_status_events` is genuinely disposable after a month.

## 7. Guest-side (Booth)

```sql
create table qr_tokens (
  id uuid primary key,
  outlet_id uuid not null, table_id uuid not null,
  token_hash text not null,                     -- store the HASH, never the token
  rotates_at timestamptz not null,
  revoked_at timestamptz,
  unique (token_hash)
);

create table guest_sessions (
  id uuid primary key,
  table_session_id uuid, store_id uuid not null,
  qr_token_id uuid not null references qr_tokens,
  preferences jsonb,                            -- the 3-tap intake
  preference_vector vector(384),                -- cached; keys the AI response cache
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
```

Guest RLS: an anonymous guest session may read **published menu items for its own store** and **its own order**, and **nothing else** — no bills, no memberships, no other tables, no stock. Test cases A11–A14 in [TENANCY.md](TENANCY.md) §6.

## 8. Idempotency

Every mutating endpoint takes a client-generated `idempotency_key uuid`.

```sql
create table idempotency_keys (
  key         uuid primary key,
  outlet_id   uuid not null,
  endpoint    text not null,
  request_hash text not null,                   -- guards key reuse with a DIFFERENT body
  response    jsonb,
  created_at  timestamptz not null default now()
);
```

On replay: same key + same `request_hash` → **return the stored response, do not re-execute.** Same key + *different* hash → **409**, because that is a client bug and must be loud, not silently tolerated. This one table underwrites offline sync, aggregator webhooks, and payment callbacks alike.
