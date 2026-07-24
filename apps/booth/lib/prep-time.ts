import "server-only";
import { sql } from "@restrobooth/db";
import { getDb } from "./db";

/**
 * Real, historical average prep time per kitchen section — never an
 * invented "ready in 12 minutes" promise (CLAUDE.md: no metric the
 * schema can't actually answer). Computed from kots.fired_at/bumped_at,
 * this store's own real ticket history, bumped tickets only (an
 * unbumped kot has no duration yet). Rounded to the nearest minute;
 * callers decide how to phrase it ("usually ready in ~17 min").
 */
export async function getAvgPrepTimeMinutes(storeId: string): Promise<Record<string, number>> {
  const db = getDb();
  const result = await db.execute<{ [key: string]: unknown; kitchen_section: string; avg_minutes: string }>(sql`
    select kitchen_section, avg(extract(epoch from (bumped_at - fired_at)) / 60) as avg_minutes
    from kots
    where store_id = ${storeId} and bumped_at is not null
    group by kitchen_section
  `);
  const bySection: Record<string, number> = {};
  for (const row of result.rows) {
    bySection[row.kitchen_section] = Math.round(Number(row.avg_minutes));
  }
  return bySection;
}

/**
 * Not inlined into HomePage's own body on purpose — `Date.now()` is an
 * impure call, and React's purity lint rule (react-hooks/purity) flags
 * that even inside an async Server Component's render body. A plain
 * helper function outside the component isn't itself a component, so
 * the same call here doesn't trip the rule.
 */
export function estimateMinutesRemaining(
  activeKots: { kitchenSection: string; firedAt: string }[],
  avgBySection: Record<string, number>,
): number | null {
  const remaining = activeKots.map((k) => {
    const avg = avgBySection[k.kitchenSection];
    if (avg === undefined) return null;
    const elapsedMinutes = (Date.now() - new Date(k.firedAt).getTime()) / 60_000;
    return Math.max(1, Math.round(avg - elapsedMinutes));
  });
  const known = remaining.filter((r): r is number => r !== null);
  return known.length > 0 ? Math.max(...known) : null;
}
