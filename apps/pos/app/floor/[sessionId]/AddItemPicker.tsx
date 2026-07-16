"use client";

import { useMemo, useState, useTransition } from "react";
import { useToast } from "@restrobooth/ui";
import { addOrderItem } from "./actions";
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
 * fired in under 15 seconds"). Each tap calls the Server Action directly
 * (not a <form> submit) so a rejection surfaces as a toast without
 * blocking the next tap; the row list itself updates via the action's own
 * revalidatePath, not local state.
 */
export function AddItemPicker({ sessionId, menu }: { sessionId: string; menu: OrderableMenuItem[] }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
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

  function handleAdd(item: OrderableMenuItem) {
    setPendingItemId(item.menuItemId);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("sessionId", sessionId);
      formData.set("menuItemId", item.menuItemId);
      formData.set("quantity", "1");
      const result = await addOrderItem({ error: null }, formData);
      if (result.error) toast(result.error, "critical");
      setPendingItemId(null);
    });
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
                disabled={pending && pendingItemId === item.menuItemId}
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
