-- Custom SQL migration file, put your code below! --

-- Local dev only. Stubs Supabase's standard `anon` / `authenticated` roles
-- so GRANT statements and `for select to anon` policies work identically
-- against local Postgres and real Supabase (which already has both roles —
-- the guards make this a no-op there).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end;
$$;

-- RLS restricts rows; it does not grant access. Supabase auto-grants this
-- for its authenticated/anon roles — this stub does the same so the two
-- environments behave identically. The real restriction is the RLS policy
-- set in 0005, not this grant.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;

-- Local dev only. Mirrors Supabase's real auth.uid(), which reads the
-- current request's JWT `sub` claim via PostgREST's per-request GUCs. This
-- stub reads the same GUC convention so `SET LOCAL request.jwt.claim.sub`
-- in a test transaction behaves identically to a real Supabase request.
-- Against real Supabase this function already exists and this is skipped
-- (see the guard below).
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid
      language sql stable
      as $fn$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $fn$;
  end if;
end;
$$;
