CREATE INDEX "outlet_group_members_outlet_id_idx" ON "outlet_group_members" USING btree ("outlet_id");--> statement-breakpoint
CREATE INDEX "kots_outlet_fired_idx" ON "kots" USING btree ("outlet_id","fired_at");--> statement-breakpoint
CREATE INDEX "table_sessions_outlet_opened_idx" ON "table_sessions" USING btree ("outlet_id","opened_at");--> statement-breakpoint
-- CREATE INDEX does not refresh planner statistics on its own. BENCH-01
-- caught this concretely: table_sessions' pre-existing row estimate was
-- so stale the planner used the new composite index for the outlet_id
-- equality only, pushed the opened_at range and both RLS subplans to a
-- post-scan Filter, and pulled all ~113K rows for the outlet off the heap
-- before discarding 113,477 of them — 181ms. A plain ANALYZE (no VACUUM
-- needed) dropped the same query to 0.3ms: a ~560x difference from
-- statistics alone, same index, same data, same plan shape otherwise.
ANALYZE "outlet_group_members";--> statement-breakpoint
ANALYZE "kots";--> statement-breakpoint
ANALYZE "table_sessions";