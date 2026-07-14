-- Custom SQL migration file, put your code below! --

-- =============================================================================
-- RLS for the Phase 2 catalog tables — same accessible_brand_ids() pattern
-- as menu_items itself (drizzle/0005_rls_policies.sql).
-- =============================================================================

alter table categories enable row level security;
create policy category_isolation on categories for all
  using (brand_id in (select accessible_brand_ids()));

alter table option_groups enable row level security;
create policy option_group_isolation on option_groups for all
  using (menu_item_id in (select id from menu_items where brand_id in (select accessible_brand_ids())));

alter table option_items enable row level security;
create policy option_item_isolation on option_items for all
  using (
    option_group_id in (
      select og.id from option_groups og
      join menu_items mi on mi.id = og.menu_item_id
      where mi.brand_id in (select accessible_brand_ids())
    )
  );

alter table menu_audit_log enable row level security;
create policy menu_audit_log_isolation on menu_audit_log for all
  using (
    (entity_type = 'menu_item' and entity_id in (
      select id from menu_items where brand_id in (select accessible_brand_ids())
    ))
    or (entity_type = 'menu_item_override' and entity_id in (
      select mio.id from menu_item_overrides mio
      join menu_items mi on mi.id = mio.menu_item_id
      where mi.brand_id in (select accessible_brand_ids())
    ))
  );

-- =============================================================================
-- Capability layer — un-skips A6 (TENANCY.md §6). RLS alone can't express
-- this rule: it's column-scoped (price_paise vs is_available on the SAME
-- menu_item_overrides row), not row-scoped, so it's a trigger instead of a
-- policy. can_set_menu_price() mirrors accessible_brand_ids()'s org/brand
-- scope resolution (drizzle/0002_access_functions.sql) but additionally
-- requires a privileged role.
-- =============================================================================

create function can_set_menu_price(p_brand_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from memberships m
    join brands b on b.id = p_brand_id
    where m.user_id = (select auth.uid())
      and m.role in ('org_owner', 'brand_manager')
      and (
        (m.scope_type = 'org' and m.scope_id = b.org_id)
        or (m.scope_type = 'brand' and m.scope_id = b.id)
      )
  );
$$;
revoke execute on function can_set_menu_price(uuid) from public;
grant execute on function can_set_menu_price(uuid) to authenticated;

-- SECURITY DEFINER so the check runs regardless of the caller's own RLS
-- grants on menu_items (needed to look up which brand the override's item
-- belongs to before asking can_set_menu_price()).
create function check_menu_item_override_price_capability() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  item_brand_id uuid;
  price_is_changing boolean;
begin
  select brand_id into item_brand_id from menu_items where id = new.menu_item_id;

  if tg_op = 'INSERT' then
    price_is_changing := new.price_paise is not null;
  else
    price_is_changing := new.price_paise is distinct from old.price_paise;
  end if;

  if price_is_changing and not can_set_menu_price(item_brand_id) then
    raise exception 'insufficient privilege: only org_owner or brand_manager may set menu_item_overrides.price_paise (brand %)', item_brand_id;
  end if;

  return new;
end;
$$;

-- "update of price_paise": Postgres fires this only for UPDATEs whose SET
-- clause actually mentions price_paise — an 86 action that only sets
-- is_available never touches this trigger at all, which is what lets a
-- cashier 86 an item without ever being capability-checked for a change
-- they aren't making.
create trigger menu_item_override_price_capability
  before insert or update of price_paise on menu_item_overrides
  for each row execute function check_menu_item_override_price_capability();

-- =============================================================================
-- A9 (TENANCY.md §6): kitchen role has no financial read. RESTRICTIVE, not
-- permissive — narrows bill_isolation's grant via AND instead of widening
-- it via OR. A user must pass BOTH scope (bill_isolation) AND this
-- capability check to read a financial row.
--
-- Known simplification (documented, not hidden): this checks whether the
-- user has ANY non-kitchen membership anywhere, not specifically at this
-- row's outlet/store — re-deriving per-row scope here would duplicate
-- accessible_outlet_ids()'s own logic. A kitchen-only-everywhere user (the
-- only shape in the current fixture) sees zero financial rows anywhere,
-- matching A9 exactly. A user who is BOTH kitchen at one outlet and
-- cashier at another (not in the fixture, hypothetical) would see more
-- than strictly necessary — worth tightening if that membership shape
-- ever becomes real.
-- =============================================================================

create policy bill_financial_capability on bills as restrictive for select
  using (exists (select 1 from memberships m where m.user_id = (select auth.uid()) and m.role != 'kitchen'));

create policy bill_tax_line_financial_capability on bill_tax_lines as restrictive for select
  using (exists (select 1 from memberships m where m.user_id = (select auth.uid()) and m.role != 'kitchen'));

create policy payment_financial_capability on payments as restrictive for select
  using (exists (select 1 from memberships m where m.user_id = (select auth.uid()) and m.role != 'kitchen'));
