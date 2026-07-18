"use client";

import { useMemo, useState } from "react";
import { useToast } from "@restrobooth/ui";
import { enqueue } from "../../../lib/offline/outbox";
import { uuid7 } from "../../../lib/offline/uuid7";
import type { OrderableMenuItem } from "./queries";
import styles from "./AddItemPicker.module.css";

function formatRupees(paise: string): string {
  const n = BigInt(paise);
  const rupees = n / 100n;
  const cents = n % 100n;
  return `${rupees}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Tap-to-add, one item at a time — DESIGN.md's POS speed goal ("the order
 * fired in under 15 seconds"). ADR-0004: this writes to the local outbox
 * and returns immediately — it never waits on a network round trip, so
 * the tap is exactly as fast offline as on. OrderPad's own `useLiveQuery`
 * on the outbox is what makes the new row appear; this component doesn't
 * hold or update the item list itself.
 */
export function AddItemPicker({ sessionId, menu }: { sessionId: string; menu: OrderableMenuItem[] }) {
  const toast = useToast();
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  const byCategory = useMemo(() => {
    const groups = new Map<string, OrderableMenuItem[]>();
    for (const item of menu) {
      const key = item.categoryName ?? "Uncategorised";
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
    return groups;
  }, [menu]);

  async function handleAdd(item: OrderableMenuItem) {
    setPendingItemId(item.menuItemId);
    try {
      await enqueue("addOrderItem", sessionId, {
        sessionId,
        orderItemId: uuid7(),
        menuItemId: item.menuItemId,
        quantity: 1,
        clientLineId: uuid7(),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not queue the item.", "critical");
    } finally {
      setPendingItemId(null);
    }
  }

  return (
    <>
      {Array.from(byCategory.entries()).map(([categoryName, items]) => (
        <div key={categoryName} className={styles.category}>
          <p className={styles.categoryName}>{categoryName}</p>
          <div className={styles.grid}>
            {items.map((item) => (
              <button
                key={item.menuItemId}
                type="button"
                className={styles.itemButton}
                disabled={pendingItemId === item.menuItemId}
                onClick={() => handleAdd(item)}
              >
                <div className={styles.itemName}>{item.name}</div>
                <div className={styles.itemPrice}>₹{formatRupees(item.pricePaise)}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
