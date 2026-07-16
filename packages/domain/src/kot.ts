/**
 * kot state machine + fire-time routing — DOMAIN.md §3.3.
 *
 * A KOT is a kitchen instruction, not a financial document. This module
 * owns the legal status transitions and `groupByKitchenSection` — the
 * function that decides how many KOTs a single "fire" produces: one per
 * distinct kitchen line the order touches (hot / cold / bar). A reprint is
 * NOT modelled here: it never changes status and never creates a second
 * KOT — it increments reprint_count and writes a print event, handled at
 * the DB layer (packages/db/src/operations/fireOrder.ts).
 */

export type KotStatus =
  | "queued" // created, handed to the print bridge / pushed to KDS
  | "printed" // the print bridge ACK'd
  | "print_failed" // no ACK — retryable
  | "acknowledged" // a KDS rendered it (may or may not exist for an outlet)
  | "preparing"
  | "ready"
  | "bumped" // kitchen done
  | "voided"; // all its items were voided

const TRANSITIONS: Record<KotStatus, readonly KotStatus[]> = {
  queued: ["printed", "print_failed", "voided"],
  // acknowledged is optional — an outlet with no KDS goes printed -> preparing.
  printed: ["acknowledged", "preparing", "voided"],
  print_failed: ["queued"], // retry
  acknowledged: ["preparing", "voided"],
  preparing: ["ready", "voided"],
  ready: ["bumped", "voided"],
  // recall un-bumps; audited, because it is also how a slow ticket gets hidden.
  bumped: ["ready"],
  voided: [],
};

export function canTransitionKot(from: KotStatus, to: KotStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertKotTransition(from: KotStatus, to: KotStatus): void {
  if (!canTransitionKot(from, to)) {
    throw new Error(`illegal kot transition: ${from} -> ${to}`);
  }
}

export type KitchenSection = "hot" | "cold" | "bar";

// A fixed order so KOT creation is deterministic (the hot ticket is always
// KOT n, the cold ticket n+1) — makes the fire operation and its tests
// reproducible regardless of the order items were added in.
const SECTION_ORDER: readonly KitchenSection[] = ["hot", "cold", "bar"];

/**
 * Groups the items being fired by their kitchen section. The fire
 * operation creates exactly one KOT per returned group — a table that
 * orders a curry (hot) and an ice cream (cold) produces two tickets, one
 * on each line, from a single tap of "fire". Empty sections are omitted;
 * groups come back in canonical section order.
 */
export function groupByKitchenSection<T extends { kitchenSection: KitchenSection }>(
  items: readonly T[],
): { section: KitchenSection; items: T[] }[] {
  const groups = new Map<KitchenSection, T[]>();
  for (const item of items) {
    const bucket = groups.get(item.kitchenSection);
    if (bucket) bucket.push(item);
    else groups.set(item.kitchenSection, [item]);
  }
  return SECTION_ORDER.filter((s) => groups.has(s)).map((s) => ({ section: s, items: groups.get(s)! }));
}
