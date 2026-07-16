/**
 * order_item state machine — DOMAIN.md §3.2.
 *
 * Append-only in the DB (the row is never edited; a quantity reduction is a
 * new negative row in order_item_voids). This module owns which status
 * transitions are legal and the one rule that gates fraud: a void AFTER
 * fire needs manager auth; a void BEFORE fire is free.
 */

export type OrderItemStatus =
  | "pending" // added, not yet fired to the kitchen
  | "fired" // on a KOT, being cooked
  | "served" // delivered to the guest
  | "void_requested" // a post-fire void is awaiting manager approval
  | "voided"; // gone (pre-fire free, or post-fire approved)

const TRANSITIONS: Record<OrderItemStatus, readonly OrderItemStatus[]> = {
  // A pending item can be fired, or voided for free (nothing was cooked).
  pending: ["fired", "voided"],
  // A fired item is served, or a manager-gated void is requested against it.
  fired: ["served", "void_requested"],
  served: [],
  // Approve -> voided (with auth + reason + wastage). Reject -> back to fired.
  void_requested: ["voided", "fired"],
  voided: [],
};

export function canTransitionOrderItem(from: OrderItemStatus, to: OrderItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertOrderItemTransition(from: OrderItemStatus, to: OrderItemStatus): void {
  if (!canTransitionOrderItem(from, to)) {
    throw new Error(`illegal order_item transition: ${from} -> ${to}`);
  }
}

/**
 * DOMAIN.md §3.2: a void BEFORE fire is free — nothing was cooked, no
 * manager auth, no wastage. A void AFTER fire costs food and requires
 * manager auth + a reason code + a wastage entry. `pending` is the only
 * pre-fire state; everything else has already been cooked.
 *
 * This is the client-side hint for which flow to show. The DB trigger in
 * 0014_ordering_capability.sql is the actual enforcement — it will reject a
 * requires_auth void whose authorizing session is not a manager, so a
 * client that lies about this never gets the row in.
 */
export function voidRequiresAuth(status: OrderItemStatus): boolean {
  return status !== "pending";
}
