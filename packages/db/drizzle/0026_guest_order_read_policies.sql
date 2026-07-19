-- Custom SQL migration file, put your code below! --

-- Phase 5 Slice 2a — the Booth's live status board needs a guest to read
-- their OWN table's order_items and kots (their order's items and its
-- kitchen tickets), the same "own session only" shape 0005_rls_policies.sql
-- already gave orders (order_guest_own_read) and guest_sessions
-- (guest_session_own_read). Neither order_items nor kots had ANY anon
-- policy before this — a guest could read the order header (orders) but
-- not its line items or ticket status.
--
-- order_items has no table_session_id of its own (only order_id) — join
-- through orders, same relationship order_guest_own_read already encodes.
-- kots.table_session_id is direct — mirror order_guest_own_read exactly.
--
-- Both stack as additional PERMISSIVE `for select` policies alongside the
-- existing staff isolation policies (order_item_isolation, kot_isolation)
-- — permissive policies OR together, so this grants access without
-- touching what staff already have. Write access remains unavailable to
-- anon (Slice 2b's own ADR + adversarial tests, not this migration).

create policy order_item_guest_own_read on order_items for select
  to anon
  using (
    order_id in (
      select id from orders where table_session_id = (
        select table_session_id from guest_sessions
        where id = nullif(current_setting('request.jwt.claim.guest_session_id', true), '')::uuid
      )
    )
  );

create policy kot_guest_own_read on kots for select
  to anon
  using (
    table_session_id = (
      select table_session_id from guest_sessions
      where id = nullif(current_setting('request.jwt.claim.guest_session_id', true), '')::uuid
    )
  );