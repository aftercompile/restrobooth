-- Trimmed by hand after drizzle-kit generate: the auto-diff re-emitted
-- 0032's tables/columns too (ai_response_cache, ai_usage_ledger,
-- outlets.ai_monthly_token_budget) because 0032 was a --custom migration,
-- which never updates drizzle-kit's tracked snapshot from schema.ts — so
-- from its diffing perspective those were still "pending." They're
-- already live on all three DBs; re-running them here would fail with
-- "already exists." The generated 0033_snapshot.json itself is correct
-- (it reflects the full current schema.ts, ai.ts included) and is kept
-- as-is — this only trims the SQL to what's actually new: Phase 6 Slice 2
-- (ADR-0007 §5A, the Booth Host) real SQL filters for the shortlist.

ALTER TABLE "menu_items" ADD COLUMN "spice_level" text;--> statement-breakpoint
ALTER TABLE "menu_items" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_items" ADD CONSTRAINT "spice_level_valid" CHECK ("menu_items"."spice_level" is null or "menu_items"."spice_level" in ('mild','medium','hot'));
