/**
 * table_session state machine — DOMAIN.md §3.1.
 *
 * Pure. No I/O. The DB persists `status`; this module is the single source
 * of truth for which transitions are legal and for the merge guard. The
 * one invariant that actually protects money is `canMerge`: you cannot fold
 * a Wok Express order into a Spice Route order — they are different brands,
 * different bills, different GSTINs (DOMAIN.md §3.1, "merges are blocked
 * across stores").
 */

export type TableSessionStatus =
  | "open" // seated, no items yet
  | "ordering" // first order_item added
  | "dining" // first KOT fired
  | "bill_requested" // menu frozen for this session
  | "settling" // bill(s) finalised, payment in progress
  | "closed" // fully paid, table released
  | "abandoned" // force-closed at day close (reason required)
  | "merged_into"; // items re-parented to another session

// Terminal states have no outgoing transitions.
const TRANSITIONS: Record<TableSessionStatus, readonly TableSessionStatus[]> = {
  open: ["ordering", "abandoned", "merged_into"],
  ordering: ["dining", "abandoned", "merged_into"],
  dining: ["bill_requested", "abandoned", "merged_into"],
  // bill_requested -> dining is the explicit un-freeze (DOMAIN.md §3.1): a
  // new item after the bill was asked for requires deliberately reopening
  // the session, so nobody adds a line after the printed total by accident.
  bill_requested: ["settling", "dining", "abandoned"],
  settling: ["closed", "abandoned"],
  closed: [],
  abandoned: [],
  merged_into: [],
};

export function isTerminalSessionStatus(status: TableSessionStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

export function canTransitionSession(from: TableSessionStatus, to: TableSessionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Throws with a legible message if the transition is illegal. */
export function assertSessionTransition(from: TableSessionStatus, to: TableSessionStatus): void {
  if (!canTransitionSession(from, to)) {
    throw new Error(`illegal table_session transition: ${from} -> ${to}`);
  }
}

export interface MergeCandidate {
  storeId: string;
  status: TableSessionStatus;
}

/**
 * DOMAIN.md §3.1: session `source` merges INTO session `target`. Blocked
 * across stores. Both must be in a mergeable state — the source must be
 * able to move to `merged_into`, and the target must not be terminal (you
 * cannot merge into a closed or already-merged session).
 */
export function canMerge(source: MergeCandidate, target: MergeCandidate): boolean {
  if (source.storeId !== target.storeId) return false;
  if (!canTransitionSession(source.status, "merged_into")) return false;
  if (isTerminalSessionStatus(target.status)) return false;
  return true;
}

/** Throws with the specific reason a merge is illegal — used at the DB call site. */
export function assertCanMerge(source: MergeCandidate, target: MergeCandidate): void {
  if (source.storeId !== target.storeId) {
    throw new Error("cannot merge sessions across stores (different brand/bill)");
  }
  if (!canTransitionSession(source.status, "merged_into")) {
    throw new Error(`source session in state '${source.status}' cannot be merged`);
  }
  if (isTerminalSessionStatus(target.status)) {
    throw new Error(`target session in terminal state '${target.status}' cannot receive a merge`);
  }
}
