-- Custom SQL migration file, put your code below! --

-- docs/TENANCY.md §4–§6. Every policy wraps accessible_*_ids() calls in
-- `(select ...)` so Postgres hoists them to a once-per-statement InitPlan
-- instead of evaluating once per row (BENCH-01 verifies this holds at
-- scale). FOR ALL policies here are the Phase 1 baseline: tenant
-- ISOLATION is enforced now (what TENANCY.md's 15 adversarial cases test);
-- the finer role CAPABILITY matrix (a cashier can't set a price) layers on
-- top as each write endpoint ships in Phase 2/3a/3b — it is deliberately
-- not attempted here.

-- =============================================================================
-- Self-referencing: outlet / store / brand
-- =============================================================================

alter table outlets enable row level security;
create policy outlet_isolation on outlets for all
  using (id in (select accessible_outlet_ids()));

alter table stores enable row level security;
create policy store_isolation on stores for all
  using (id in (select accessible_store_ids()));

alter table brands enable row level security;
create policy brand_isolation on brands for all
  using (id in (select accessible_brand_ids()));

-- =============================================================================
-- Org-level lookup tables
-- =============================================================================

alter table organizations enable row level security;
create policy org_isolation on organizations for all
  using (
    id in (select org_id from outlets where id in (select accessible_outlet_ids()))
    or id in (select org_id from brands where id in (select accessible_brand_ids()))
  );

alter table gst_registrations enable row level security;
create policy gst_registration_isolation on gst_registrations for all
  using (org_id in (select org_id from outlets where id in (select accessible_outlet_ids())));

alter table tax_classes enable row level security;
create policy tax_class_isolation on tax_classes for all
  using (org_id in (select org_id from outlets where id in (select accessible_outlet_ids())));

alter table outlet_groups enable row level security;
create policy outlet_group_isolation on outlet_groups for all
  using (id in (select outlet_group_id from outlet_group_members where outlet_id in (select accessible_outlet_ids())));

alter table outlet_group_members enable row level security;
create policy outlet_group_members_isolation on outlet_group_members for all
  using (outlet_id in (select accessible_outlet_ids()));

-- =============================================================================
-- Simple outlet-scoped tables
-- =============================================================================

alter table areas enable row level security;
create policy area_isolation on areas for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table tables enable row level security;
create policy table_isolation on tables for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table terminals enable row level security;
create policy terminal_isolation on terminals for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table business_days enable row level security;
create policy business_day_isolation on business_days for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table outlet_event_counters enable row level security;
create policy outlet_event_counter_isolation on outlet_event_counters for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table idempotency_keys enable row level security;
create policy idempotency_key_isolation on idempotency_keys for all
  using (outlet_id in (select accessible_outlet_ids()));

-- KOTs are deliberately OUTLET-scoped only, never store-scoped: a shared
-- cloud kitchen's KDS must show every brand's tickets (docs/TENANCY.md §2
-- Case A). store_id on kots/kot_items is display-tagging only.
alter table kots enable row level security;
create policy kot_isolation on kots for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table kot_items enable row level security;
create policy kot_item_isolation on kot_items for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table order_status_events enable row level security;
create policy order_status_event_isolation on order_status_events for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table invoice_series enable row level security;
create policy invoice_series_isolation on invoice_series for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table invoice_number_blocks enable row level security;
create policy invoice_number_block_isolation on invoice_number_blocks for all
  using (invoice_series_id in (select id from invoice_series where outlet_id in (select accessible_outlet_ids())));

alter table invoice_number_gaps enable row level security;
create policy invoice_number_gap_isolation on invoice_number_gaps for all
  using (invoice_series_id in (select id from invoice_series where outlet_id in (select accessible_outlet_ids())));

-- =============================================================================
-- Store-scoped tables (BOTH predicates — the fix for adversarial case A8:
-- brand isolation *inside* a shared cloud kitchen. accessible_outlet_ids()
-- alone is not enough because it is deliberately brand-inclusive.)
-- =============================================================================

alter table table_sessions enable row level security;
create policy table_session_isolation on table_sessions for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

alter table table_session_tables enable row level security;
create policy table_session_table_isolation on table_session_tables for all
  using (
    table_session_id in (
      select id from table_sessions
      where outlet_id in (select accessible_outlet_ids())
        and store_id in (select accessible_store_ids())
    )
  );

alter table orders enable row level security;
create policy order_isolation on orders for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

alter table order_items enable row level security;
create policy order_item_isolation on order_items for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

alter table order_item_voids enable row level security;
create policy order_item_void_isolation on order_item_voids for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

alter table bills enable row level security;
create policy bill_isolation on bills for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

alter table bill_tax_lines enable row level security;
create policy bill_tax_line_isolation on bill_tax_lines for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table payments enable row level security;
create policy payment_isolation on payments for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

-- =============================================================================
-- Brand-scoped tables (no outlet_id at all)
-- =============================================================================

alter table dayparts enable row level security;
create policy daypart_isolation on dayparts for all
  using (brand_id in (select accessible_brand_ids()));

alter table promos enable row level security;
create policy promo_isolation on promos for all
  using (brand_id in (select accessible_brand_ids()));

alter table menu_items enable row level security;
create policy menu_item_staff_isolation on menu_items for all
  using (brand_id in (select accessible_brand_ids()));
-- Anonymous Booth guests may read published items only (test case A12).
-- Availability/price for a specific store still resolve via resolve_menu(),
-- which is SECURITY DEFINER and does not depend on this policy.
create policy menu_item_public_read on menu_items for select
  to anon
  using (status = 'published');

alter table menu_item_overrides enable row level security;
create policy menu_item_override_isolation on menu_item_overrides for all
  using (menu_item_id in (select id from menu_items where brand_id in (select accessible_brand_ids())));
create policy menu_item_override_public_read on menu_item_overrides for select
  to anon
  using (status = 'published');

-- =============================================================================
-- Memberships — a user sees their own; org_owner sees everyone in outlets
-- they control. Fine-grained membership management is a later-phase concern.
-- =============================================================================

alter table memberships enable row level security;
create policy membership_self_read on memberships for all
  using (
    user_id = (select auth.uid())
    or scope_id in (select accessible_outlet_ids())
  );

-- =============================================================================
-- Booth (anonymous guest surface). qr_tokens are never directly readable —
-- token validation happens server-side against the hash, not via RLS.
-- guest_sessions: staff read their own stores' sessions (support/debugging);
-- an anonymous guest reads only their OWN session, identified by a custom
-- JWT claim minted when the Edge Function issues their scoped token
-- (Phase 5 concern — this claim shape is provisional until the real
-- token-minting flow exists and the RLS suite exercises it for real).
-- =============================================================================

alter table qr_tokens enable row level security;
create policy qr_token_staff_isolation on qr_tokens for all
  using (outlet_id in (select accessible_outlet_ids()));

alter table guest_sessions enable row level security;
create policy guest_session_staff_isolation on guest_sessions for all
  using (store_id in (select accessible_store_ids()));
create policy guest_session_own_read on guest_sessions for select
  to anon
  using (id = nullif(current_setting('request.jwt.claim.guest_session_id', true), '')::uuid);

-- Anonymous guests may read orders belonging to their OWN table session
-- only (test case A11: a guest at T5 must not read orders for T6).
create policy order_guest_own_read on orders for select
  to anon
  using (
    table_session_id = (
      select table_session_id from guest_sessions
      where id = nullif(current_setting('request.jwt.claim.guest_session_id', true), '')::uuid
    )
  );
