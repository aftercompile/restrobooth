"use client";

import { useMemo, useState, useTransition } from "react";
import { useToast } from "@restrobooth/ui";
import { addOrderItem } from "./actions";
import type { OrderableMenuItem } from "./queries";
import styles from "./AddItemPicker.module.css";

function formatRupees(paise: string): string {
  const n = BigInt(paise);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

/** Same tap-to-add pattern as apps/pos's AddItemPicker — a single column
 *  list here instead of a grid, for a thumb-scrollable phone screen. */
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
          <div className={styles.list}>
            {items.map((item) => (
              <button
                key={item.menuItemId}
                type="button"
                className={styles.itemButton}
                disabled={pending && pendingItemId === item.menuItemId}
                onClick={() => handleAdd(item)}
              >
                <span className={styles.itemName}>{item.name}</span>
                <span className={styles.itemPrice}>₹{formatRupees(item.pricePaise)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
