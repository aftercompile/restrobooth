-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- Phase 3a capability layer. Three rules from TENANCY.md §4's capability
-- matrix and DOMAIN.md §3, none of which plain scope-isolation RLS can
-- express on its own. Same discipline as 0012_menu_capability.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rule 1 — "Take an order" is a role capability, not just a scope one.
-- TENANCY.md §4: brand_manager and kitchen are NOT permitted to take an
-- order. A RESTRICTIVE policy ANDs a role check onto the existing permissive
-- order_isolation/order_item_isolation policies (same shape as 0012's
-- bill_financial_capability). Restrictive INSERT uses WITH CHECK. Reads are
-- unaffected — a brand_manager still reads orders in scope (needed for A8's
-- own test and for reports); only CREATING one is gated.
-- -----------------------------------------------------------------------------
create policy order_take_capability on orders as restrictive for insert
  with check (
    exists (
      select 1 from memberships m
      where m.user_id = (select auth.uid())
        and m.role in ('org_owner','cluster_manager','outlet_manager','cashier','captain')
    )
  );

create policy order_item_take_capability on order_items as restrictive for insert
  with check (
    exists (
      select 1 from memberships m
      where m.user_id = (select auth.uid())
        and m.role in ('org_owner','cluster_manager','outlet_manager','cashier','captain')
    )
  );

-- -----------------------------------------------------------------------------
-- Rule 2 — A void AFTER fire requires manager auth (DOMAIN.md §3.2, the
-- fraud-sensitive path). TENANCY.md §4 "Void a fired KOT item": only
-- org_owner / cluster_manager / outlet_manager — never cashier, never
-- captain. This is a trigger, not a policy, because it has to (a) read the
-- authorizing session's own auth.uid() and stamp it server-side rather than
-- trust a client-supplied authorized_by, and (b) key the check on the
-- requires_auth flag of the row being inserted.
--
-- can_authorize_void() takes the OUTLET being acted on (like
-- can_set_menu_price() takes a brand) and reads auth.uid() internally — it
-- never takes a user id, so it can't be turned into a lookup oracle for
-- another user's privileges (TENANCY.md §6 A15). brand_manager has no
-- branch here at all: their 'brand' scope simply never matches.
-- -----------------------------------------------------------------------------
create function can_authorize_void(p_outlet_id uuid)
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
      and m.role in ('org_owner','cluster_manager','outlet_manager')
      and (
           (m.scope_type = 'org'          and m.scope_id = o.org_id)
        or (m.scope_type = 'outlet'       and m.scope_id = o.id)
        or (m.scope_type = 'outlet_group' and m.scope_id in (
              select outlet_group_id from outlet_group_members where outlet_id = o.id))
      )
  );
$$;
revoke execute on function can_authorize_void(uuid) from public;
grant execute on function can_authorize_void(uuid) to authenticated;

create function enforce_void_authorization() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- A pre-fire void (requires_auth = false) is free — nothing to authorize,
  -- authorized_by stays null (permitted by the auth_required_check
  -- constraint). A post-fire void must be signed by a manager: we stamp the
  -- authorizer from the session's own uid (never the client's claim) and
  -- reject unless that session actually holds a void-authorizing role.
  if new.requires_auth then
    new.authorized_by := (select auth.uid());
    if not can_authorize_void(new.outlet_id) then
      raise exception 'insufficient privilege: only org_owner, cluster_manager or outlet_manager may authorize a post-fire void (outlet %)', new.outlet_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger order_item_void_authorization
  before insert on order_item_voids
  for each row execute function enforce_void_authorization();

-- -----------------------------------------------------------------------------
-- Rule 3 — a merge is blocked across stores (DOMAIN.md §3.1: "you cannot
-- merge a Behrouz order into a Faasos order"). The domain layer
-- (packages/domain canMerge) guards the app path, but this is a correctness
-- invariant worth enforcing at the DB too, same philosophy as the money
-- reconcile constraints — a bug or a raw write must not be able to fold two
-- brands' orders into one bill. SECURITY DEFINER so the target-session
-- lookup sees the row regardless of the acting role's RLS.
-- -----------------------------------------------------------------------------
create function enforce_merge_same_store() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  target_store uuid;
begin
  if new.status = 'merged_into' and new.merged_into_session_id is not null then
    select store_id into target_store from table_sessions where id = new.merged_into_session_id;
    if target_store is distinct from new.store_id then
      raise exception 'cannot merge table_session % into % — different stores (% vs %)',
        new.id, new.merged_into_session_id, new.store_id, target_store;
    end if;
  end if;
  return new;
end;
$$;

create trigger table_session_merge_same_store
  before insert or update on table_sessions
  for each row execute function enforce_merge_same_store();
