-- Custom SQL migration file, put your code below! --

-- docs/TENANCY.md §7.3. Binary specificity weights reproduce the
-- brand -> store -> channel -> daypart -> promo precedence chain as a
-- provable total order: each weight exceeds the sum of all lower weights,
-- so no two different combinations can ever tie (only same-combination
-- rows can, which is what published_at DESC in resolve_menu() below is for).
alter table menu_item_overrides add column specificity int generated always as (
    (case when promo_id     is not null then 8 else 0 end)
  + (case when daypart_id   is not null then 4 else 0 end)
  + (case when channel_code is not null then 2 else 0 end)
  + (case when store_id     is not null then 1 else 0 end)
) stored;

-- The pass/fail index for BENCH-02 R1 (docs/BENCHMARKS.md): p95 < 50 ms
-- resolving a full store menu.
create index menu_item_overrides_resolve_idx
  on menu_item_overrides (menu_item_id, specificity desc)
  where status = 'published';

-- docs/TENANCY.md §7.3/§7.4. price_paise and is_available resolve
-- INDEPENDENTLY — each takes the highest-specificity row where that
-- specific field is non-null. This is what makes an 86 (row 17 of the
-- 21-row precedence table) not erase an unrelated price override.
--
-- PROVISIONAL per adr/0006-override-resolution.md pending BENCH-02: this
-- is the live-resolution implementation. If the benchmark fails, the
-- escalation ladder (index -> app cache -> materialised view) applies
-- before this function is touched, not instead of it — every menu read
-- calls this one function, so whichever tier wins, there is exactly one
-- call site to change.
create function resolve_menu(p_store_id uuid, p_channel_code text, p_at timestamptz default now())
returns table (
  menu_item_id uuid,
  price_paise bigint,
  is_available boolean
)
language sql
stable
as $$
  with active_dayparts as (
    select d.id from dayparts d
    join stores s on s.id = p_store_id
    where d.brand_id = s.brand_id
      and extract(dow from p_at at time zone 'Asia/Kolkata')::int = any(d.days_of_week)
      and (p_at at time zone 'Asia/Kolkata')::time between d.start_time and d.end_time
  ),
  active_promos as (
    select pr.id from promos pr
    join stores s on s.id = p_store_id
    where pr.brand_id = s.brand_id
      and pr.status = 'active'
      and pr.starts_at <= p_at
      and (pr.ends_at is null or pr.ends_at > p_at)
  ),
  candidates as (
    select o.*
    from menu_item_overrides o
    where o.status = 'published'
      and (o.store_id is null or o.store_id = p_store_id)
      and (o.channel_code is null or o.channel_code = p_channel_code)
      and (o.daypart_id is null or o.daypart_id in (select id from active_dayparts))
      and (o.promo_id is null or o.promo_id in (select id from active_promos))
      and p_at >= o.effective_from
      and (o.effective_to is null or p_at < o.effective_to)
  ),
  price_winner as (
    select distinct on (menu_item_id) menu_item_id, price_paise
    from candidates
    where price_paise is not null
    order by menu_item_id, specificity desc, published_at desc nulls last
  ),
  availability_winner as (
    select distinct on (menu_item_id) menu_item_id, is_available
    from candidates
    where is_available is not null
    order by menu_item_id, specificity desc, published_at desc nulls last
  )
  select
    mi.id as menu_item_id,
    coalesce(pw.price_paise, mi.base_price_paise) as price_paise,
    coalesce(aw.is_available, true) as is_available
  from menu_items mi
  join stores s on s.id = p_store_id
  left join price_winner pw on pw.menu_item_id = mi.id
  left join availability_winner aw on aw.menu_item_id = mi.id
  where mi.brand_id = s.brand_id
    and mi.status = 'published';
$$;
