-- BENCH-01 variant C support. Not a real migration — never applied outside
-- this benchmark run, and always torn down in the same script (see
-- bench-01.ts's try/finally).
--
-- The variable under test is specifically the STABLE-vs-VOLATILE marking,
-- not IN-list syntax: `outlet_id in (select accessible_outlet_ids())` on a
-- SETOF-returning STABLE function is already recognised by the planner as
-- non-correlated and gets InitPlan-hoisted regardless of the explicit
-- `(select ...)` wrapper — the wrapper is defensive/idiomatic (and matters
-- a great deal for SCALAR functions like auth.uid(), which is why every
-- Supabase RLS guide leads with it), but for THIS function shape the
-- decisive factor is the volatility marking: a VOLATILE function is
-- defined as "may return a different result on every call within a single
-- statement," so Postgres is contractually required to re-evaluate it once
-- per row no matter how the calling SQL is written. That is the actual
-- trap BENCHMARKS.md's escalation ladder step 2 names ("verify the
-- InitPlan hoist... the wrapper or the STABLE marking is wrong").

create or replace function accessible_outlet_ids_naive()
  returns setof uuid
  language sql
  volatile
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
grant execute on function accessible_outlet_ids_naive() to authenticated, anon;

create or replace function accessible_store_ids_naive()
  returns setof uuid
  language sql
  volatile
  security definer
  set search_path = public
as $$
  select s.id from stores s
  join outlets o on o.id = s.outlet_id
  join memberships m on m.user_id = (select auth.uid())
  where (m.scope_type = 'org' and m.scope_id = o.org_id)
     or (m.scope_type = 'brand' and m.scope_id = s.brand_id)
     or (m.scope_type = 'outlet' and m.scope_id = s.outlet_id)
     or (m.scope_type = 'outlet_group' and s.outlet_id in (
           select outlet_id from outlet_group_members where outlet_group_id = m.scope_id));
$$;
grant execute on function accessible_store_ids_naive() to authenticated, anon;

drop policy if exists order_isolation on orders;
create policy order_isolation_naive on orders for all
  using (
    outlet_id in (select accessible_outlet_ids_naive())
    and store_id in (select accessible_store_ids_naive())
  );

drop policy if exists bill_isolation on bills;
create policy bill_isolation_naive on bills for all
  using (
    outlet_id in (select accessible_outlet_ids_naive())
    and store_id in (select accessible_store_ids_naive())
  );
