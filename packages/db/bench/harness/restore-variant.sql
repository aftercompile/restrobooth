-- Restores the real (variant B) policies after a variant C run. Statements
-- copied verbatim from drizzle/0005_rls_policies.sql — kept here rather
-- than re-run via drizzle-kit so a benchmark run can restore mid-script.

drop policy if exists order_isolation_naive on orders;
create policy order_isolation on orders for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

drop policy if exists bill_isolation_naive on bills;
create policy bill_isolation on bills for all
  using (
    outlet_id in (select accessible_outlet_ids())
    and store_id in (select accessible_store_ids())
  );

drop function if exists accessible_outlet_ids_naive();
drop function if exists accessible_store_ids_naive();
