/**
 * The state rail's time-temperature ramp (DESIGN.md "Direction B — Service
 * Board"): fresh -> warming -> hot -> critical, bound to elapsed time.
 * Pure function of (elapsedMs, thresholds) — no clock reads here, so it's
 * trivially testable and the caller (POS floor map now; KDS ticket aging
 * in Phase 4) supplies its own now().
 *
 * Thresholds are a parameter, not a constant baked into the function,
 * because a table's dwell clock and a kitchen ticket's cook clock run on
 * very different scales — a 60-minute table sit is normal; a 60-minute
 * KOT would mean the kitchen forgot the order.
 */

export type RampState = "fresh" | "warming" | "hot" | "critical";

export interface RampThresholds {
  warmingAfterMs: number;
  hotAfterMs: number;
  criticalAfterMs: number;
}

// A dine-in table's own dwell clock: how long a party has occupied a
// table. Not a KOT aging clock — Phase 4 (KDS) defines its own, tighter
// thresholds for ticket age, since "the kitchen hasn't started" at 15
// minutes is already a problem in a way a table just sitting is not.
export const TABLE_DWELL_THRESHOLDS: RampThresholds = {
  warmingAfterMs: 15 * 60_000,
  hotAfterMs: 30 * 60_000,
  criticalAfterMs: 60 * 60_000,
};

// A KOT's own cook clock (DOMAIN.md §3.3: age is computed from fired_at,
// never printed_at or acknowledged_at — a jammed printer doesn't excuse
// the guest's wait). Tighter than a table's dwell clock on purpose: a
// ticket unstarted at 8 minutes is already an anomaly a cook needs to see,
// in a way a table just sitting for 8 minutes is not.
export const KOT_AGE_THRESHOLDS: RampThresholds = {
  warmingAfterMs: 5 * 60_000,
  hotAfterMs: 10 * 60_000,
  criticalAfterMs: 15 * 60_000,
};

export function rampStateForElapsed(elapsedMs: number, thresholds: RampThresholds): RampState {
  if (elapsedMs >= thresholds.criticalAfterMs) return "critical";
  if (elapsedMs >= thresholds.hotAfterMs) return "hot";
  if (elapsedMs >= thresholds.warmingAfterMs) return "warming";
  return "fresh";
}
