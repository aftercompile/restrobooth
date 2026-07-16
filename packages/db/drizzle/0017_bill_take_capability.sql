-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- TENANCY.md §6 case A7: "captain @ outlet:AMD-1, insert into bills(...),
-- denied." No code path existed to enforce this against until Phase 3b
-- actually builds bill creation — this is that code path.
--
-- Financial-capability roles only (org_owner/cluster_manager/outlet_manager/
-- cashier) — matches "Settle a bill" and the other bill-adjacent rows in
-- TENANCY.md §4's matrix. Neither captain nor kitchen ever gets a financial
-- write; brand_manager doesn't either (financial actions are outlet-scoped,
-- not brand-scoped, in this matrix).
-- =============================================================================

create policy bill_take_capability on bills as restrictive for insert
  with check (
    exists (
      select 1 from memberships m
      where m.user_id = (select auth.uid())
        and m.role in ('org_owner', 'cluster_manager', 'outlet_manager', 'cashier')
    )
  );
