"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Card, CardHeader, QuantityStepper, formatPaiseAsRupees, TabularNumber, useToast } from "@restrobooth/ui";
import type { GuestOrderItem } from "../lib/order-queries";
import { addToCartAction, placeOrderAction, removeFromCartAction, type SimpleActionState } from "./actions";
import styles from "./CartSection.module.css";

const INITIAL: SimpleActionState = { error: null };

interface GroupedLine {
  menuItemId: string;
  name: string;
  unitPricePaise: string;
  /** One entry per underlying pending order_items row — addToCart always
   *  inserts a fresh qty=1 row per tap (order-mutations.ts's own comment:
   *  "no stepper... a second tap adds a second line"), so a guest's "3 of
   *  the same dish" is really 3 separate rows. Grouped here for display
   *  and quantity adjustment; decreasing removes exactly one of these
   *  ids, never a partial-quantity update no mutation here supports. */
  orderItemIds: string[];
}

function groupByMenuItem(items: GuestOrderItem[]): GroupedLine[] {
  const map = new Map<string, GroupedLine>();
  for (const item of items) {
    const existing = map.get(item.menuItemId);
    if (existing) existing.orderItemIds.push(item.orderItemId);
    else map.set(item.menuItemId, { menuItemId: item.menuItemId, name: item.name, unitPricePaise: item.unitPricePaise, orderItemIds: [item.orderItemId] });
  }
  return Array.from(map.values());
}

/**
 * The cart — pending order_items only, editable (quantity +/-) and
 * totalable. This IS server state (order-mutations.ts writes it
 * immediately on tap, in apps/booth/app/menu/MenuBrowser.tsx), which is
 * exactly what makes it survive a minimized tab or a re-scan on a
 * different browser: there is no client-side cart to lose, only a
 * server table_session's pending items, re-readable by anyone whose
 * guest_session_id resolves to it.
 *
 * "Total" here is genuinely pre-tax (each unitPricePaise is the resolved
 * menu price; tax is computed once at bill time by packages/domain's
 * computeBill, per-component, half-up — CLAUDE.md's own money rule) — the
 * label says so rather than implying this is the final payable amount.
 */
export function CartSection({ items }: { items: GuestOrderItem[] }) {
  const toast = useToast();
  const [busyMenuItemId, setBusyMenuItemId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [state, formAction, placing] = useActionState(placeOrderAction, INITIAL);

  if (items.length === 0) return null;

  const groups = groupByMenuItem(items);
  const totalPaise = items.reduce((sum, item) => sum + BigInt(item.unitPricePaise) * BigInt(item.quantity), 0n);
  const busy = (menuItemId: string) => pending && busyMenuItemId === menuItemId;

  function handleIncrease(group: GroupedLine) {
    if (busy(group.menuItemId)) return;
    setBusyMenuItemId(group.menuItemId);
    startTransition(async () => {
      const result = await addToCartAction(group.menuItemId);
      if (result.error) toast(result.error, "critical");
      setBusyMenuItemId(null);
    });
  }

  function handleDecrease(group: GroupedLine) {
    if (busy(group.menuItemId)) return;
    const orderItemId = group.orderItemIds[group.orderItemIds.length - 1];
    if (!orderItemId) return;
    setBusyMenuItemId(group.menuItemId);
    startTransition(async () => {
      const result = await removeFromCartAction(orderItemId);
      if (result.error) toast(result.error, "critical");
      setBusyMenuItemId(null);
    });
  }

  return (
    <Card>
      <CardHeader title="Your cart" count={groups.length} />
      <div className={styles.card}>
        {groups.map((group) => (
          <div key={group.menuItemId} className={styles.row}>
            <div className={styles.rowInfo}>
              <span className={styles.name}>{group.name}</span>
              <span className={styles.linePrice}>
                <TabularNumber>₹{formatPaiseAsRupees(BigInt(group.unitPricePaise) * BigInt(group.orderItemIds.length))}</TabularNumber>
              </span>
            </div>
            <div className={styles.stepperRow}>
              <QuantityStepper
                quantity={group.orderItemIds.length}
                min={0}
                onDecrease={() => handleDecrease(group)}
                onIncrease={() => handleIncrease(group)}
              />
            </div>
          </div>
        ))}

        <div className={styles.totalRow}>
          <span>Subtotal</span>
          <TabularNumber>₹{formatPaiseAsRupees(totalPaise)}</TabularNumber>
        </div>
        <p className={styles.taxNote}>Taxes calculated at billing</p>

        <form action={formAction}>
          <Button type="submit" variant="primary" className={styles.placeOrderButton} disabled={placing}>
            {placing ? "Placing order…" : "Place order"}
          </Button>
          {state.error && <p className={styles.error}>{state.error}</p>}
        </form>
      </div>
    </Card>
  );
}
