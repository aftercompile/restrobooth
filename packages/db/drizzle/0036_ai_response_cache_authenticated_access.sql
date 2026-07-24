-- Custom SQL migration file — no schema change, RLS policy only.
--
-- Real bug found live in Phase 6 Slice 5's AI-on verification (the first
-- time a real OPENROUTER_API_KEY was configured this project): a staff-
-- triggered call to extractReviewAspects() from Console's /reviews page
-- (running under queryAsCurrentUser's RLS-scoped `authenticated` role,
-- Slice 4/5's own widening of extractReviewAspects/getUpsellSuggestions
-- to accept an RlsTx) failed with "new row violates row-level security
-- policy for table ai_response_cache" the moment the real LLM call
-- actually succeeded and tried to cache the result.
--
-- 0032_ai_layer_spine.sql enabled RLS on ai_response_cache with
-- DELIBERATELY zero policies, reasoning "only the AI role and the
-- privileged connection ever touch this table" — true for Slices 2/3
-- (Booth Host, Upsell — both guest-facing, always called on the
-- privileged connection, which bypasses RLS entirely) but false the
-- moment Slice 4 added a legitimate STAFF-triggered AI feature running
-- under real RLS. This bug stayed invisible through all of Slice 4/5's
-- verification because no real API key was configured until now — the
-- cache write is only reached after a real (non-fallback) completion.
--
-- The fix reopens it, not narrows the caller: ai_response_cache has NO
-- tenant columns at all (cache_key/feature/response/created_at/
-- expires_at only) — the content-hash cache_key IS the isolation
-- boundary (it bakes in store_id/text), not a row-level policy, exactly
-- as 0032's own comment already argued ("a cache HIT still only ever
-- reaches a guest through the normal store-scoped code path that
-- computed the key"). That reasoning holds regardless of which role
-- reads/writes it, so a permissive policy for both roles that ever call
-- into packages/ai (authenticated: Console; anon: the guest-facing
-- surfaces, for defense in depth even though they currently go through
-- the privileged connection) is the correct fix, not a workaround.
create policy ai_response_cache_shared on ai_response_cache for all
  to authenticated, anon
  using (true)
  with check (true);