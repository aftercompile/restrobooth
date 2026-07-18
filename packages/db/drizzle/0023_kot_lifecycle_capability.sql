-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- Phase 4 Slice 3 — the kitchen half of the KOT state machine (DOMAIN.md
-- §3.3: queued -> printed -> acknowledged -> preparing -> ready -> bumped,
-- plus bumped -> ready recall). TENANCY.md §4's capability matrix has only
-- ONE explicit row for this lifecycle — "Bump a KOT" — and it is
-- deliberately broad: org_owner, cluster_manager, outlet_manager, cashier,
-- captain, kitchen. Everyone physically able to touch a ticket, except
-- brand_manager (a remote, cross-outlet role with no kitchen presence).
-- The same role set gates every transition in this lifecycle, not just
-- bump — the matrix doesn't carve out ack/start/ready separately, and
-- there's no principled reason a role that may bump a ticket may not also
-- move it through the states leading up to that.
-- =============================================================================
create function can_manage_kot(p_outlet_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from outlets o
    join memberships m on m.user_id = (select auth.uid())
    where o.id = p_outlet_id
      and m.role in ('org_owner','cluster_manager','outlet_manager','cashier','captain','kitchen')
      and (
           (m.scope_type = 'org'          and m.scope_id = o.org_id)
        or (m.scope_type = 'outlet'       and m.scope_id = o.id)
        or (m.scope_type = 'outlet_group' and m.scope_id in (
              select outlet_group_id from outlet_group_members where outlet_id = o.id))
      )
  );
$$;
revoke execute on function can_manage_kot(uuid) from public;
grant execute on function can_manage_kot(uuid) to authenticated;

create policy kot_lifecycle_capability on kots as restrictive for update
  using (can_manage_kot(outlet_id));
