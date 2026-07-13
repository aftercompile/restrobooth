-- Custom SQL migration file, put your code below! --

-- docs/TENANCY.md §4. STABLE + no argument (an access function that resolves
-- an arbitrary user's scope is an information-disclosure oracle — see
-- adversarial case A15). Every RLS policy wraps the call in `(select ...)`
-- so Postgres evaluates it once per statement (InitPlan) instead of once
-- per row — that wrapper is the whole performance story, see BENCH-01.
create function accessible_outlet_ids()
  returns setof uuid
  language sql
  stable
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
grant execute on function accessible_outlet_ids() to authenticated;

-- docs/TENANCY.md §7.1's "second predicate" for store-scoped tables. This is
-- the actual fix for adversarial case A8: accessible_outlet_ids() is
-- deliberately brand-inclusive (a brand manager's outlet set includes every
-- outlet carrying their brand, even a shared cloud kitchen), which is
-- correct for outlet-level resources but WRONG for store-scoped ones — it
-- would let a brand manager read a sibling brand's orders at a shared
-- outlet. accessible_store_ids() is scoped per membership type instead:
-- outlet/outlet_group grants ALL stores at that outlet (brand-agnostic —
-- an outlet_manager sees every brand's tickets); brand/org grants that
-- brand's stores at EVERY outlet (brand-agnostic across outlets).
create function accessible_store_ids()
  returns setof uuid
  language sql
  stable
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
revoke execute on function accessible_store_ids() from public;
grant execute on function accessible_store_ids() to authenticated;

-- For brand-scoped-only resources with no outlet_id at all (dayparts,
-- promos, menu_items). A brand is accessible if its own membership grants
-- it directly, or transitively through any outlet that carries one of its
-- stores — this is what lets outlet-level staff read their own store's
-- menu without needing a separate brand-level membership.
create function accessible_brand_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select distinct b.id from brands b
  join memberships m on m.user_id = (select auth.uid())
  where (m.scope_type = 'org' and m.scope_id = b.org_id)
     or (m.scope_type = 'brand' and m.scope_id = b.id)
     or (m.scope_type in ('outlet','outlet_group') and exists (
           select 1 from stores s
           where s.brand_id = b.id
             and ((m.scope_type = 'outlet' and s.outlet_id = m.scope_id)
               or (m.scope_type = 'outlet_group' and s.outlet_id in (
                     select outlet_id from outlet_group_members where outlet_group_id = m.scope_id)))
         ));
$$;
revoke execute on function accessible_brand_ids() from public;
grant execute on function accessible_brand_ids() to authenticated;
