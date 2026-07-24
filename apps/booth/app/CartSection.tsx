"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Card, CardHeader, formatPaiseAsRupees, TabularNumber, useToast } from "@restrobooth/ui";
import type { GuestOrderItem } from "../lib/order-queries";
import { placeOrderAction, removeFromCartAction, type SimpleActionState } from "./actions";
import styles from "./CartSection.module.css";

const INITIAL: SimpleActionState = { error: null };

/**
 * The cart — pending order_items only, editable (remove) and totalable.
 * This IS server state (order-mutations.ts writes it immediately on tap,
 * in apps/booth/app/menu/MenuBrowser.tsx), which is exactly what makes it
 * survive a minimized tab or a re-scan on a different browser: there is no
 * client-side cart to lose, only a server table_session's pending items,
 * re-readable by anyone whose guest_session_id resolves to it.
 */
export function CartSection({ items }: { items: GuestOrderItem[] }) {
  const toast = useToast();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removing, startRemoving] = useTransition();
  const [state, formAction, placing] = useActionState(placeOrderAction, INITIAL);

  if (items.length === 0) return null;

  const totalPaise = items.reduce((sum, item) => sum + BigInt(item.unitPricePaise) * BigInt(item.quantity), 0n);

  function handleRemove(orderItemId: string) {
    setRemovingId(orderItemId);
    startRemoving(async () => {
      const result = await removeFromCartAction(orderItemId);
      if (result.error) toast(result.error, "critical");
      setRemovingId(null);
    });
  }

  return (
    <Card>
      <CardHeader title="Your cart" count={items.length} />
      <div className={styles.card}>
        {items.map((item) => (
          <div key={item.orderItemId} className={styles.row}>
            <span>
              <span className={styles.name}>{item.name}</span>
              {item.quantity > 1 && <span className={styles.qty}>×{item.quantity}</span>}
            </span>
            <span className={styles.trailing}>
              <TabularNumber>₹{formatPaiseAsRupees(BigInt(item.unitPricePaise) * BigInt(item.quantity))}</TabularNumber>
              <button
                type="button"
                className={styles.removeButton}
                aria-label={`Remove ${item.name}`}
                disabled={removing && removingId === item.orderItemId}
                onClick={() => handleRemove(item.orderItemId)}
              >
                ×
              </button>
            </span>
          </div>
        ))}

        <div className={styles.totalRow}>
          <span>Total</span>
          <TabularNumber>₹{formatPaiseAsRupees(totalPaise)}</TabularNumber>
        </div>

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
