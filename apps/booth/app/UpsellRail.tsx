"use client";

import { useState, useTransition } from "react";
import { formatPaiseAsRupees, useToast } from "@restrobooth/ui";
import { addToCartAction } from "./actions";
import type { UpsellResult } from "@restrobooth/ai";
import styles from "./UpsellRail.module.css";

/** RESTROBOOTH_BRIEF.md §5E — "goes well with" at the cart. Sits between
 *  the cart's item rows and the Place order button (apps/booth/app/page.tsx);
 *  `result.aiUsed` is never surfaced to the guest, same reasoning as the
 *  Booth Host's rail — both paths are designed to read as genuinely useful. */
export function UpsellRail({ result }: { result: UpsellResult }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (result.items.length === 0) return null;

  function handleAdd(item: UpsellResult["items"][number]) {
    setPendingId(item.menuItemId);
    startTransition(async () => {
      const res = await addToCartAction(item.menuItemId);
      if (res.error) toast(res.error, "critical");
      else toast(`Added to your table`, "neutral");
      setPendingId(null);
    });
  }

  return (
    <div className={styles.section}>
      <p className={styles.title}>Perfect with your meal</p>
      <div className={styles.rail}>
        {result.items.map((item) => (
          <div key={item.menuItemId} className={styles.card}>
            <p className={styles.itemName}>{item.name}</p>
            <p className={styles.reason}>{item.reason}</p>
            <div className={styles.footer}>
              <span className={styles.price}>₹{formatPaiseAsRupees(BigInt(item.pricePaise))}</span>
              <button
                type="button"
                className={styles.addButton}
                disabled={pending && pendingId === item.menuItemId}
                onClick={() => handleAdd(item)}
              >
                Add
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
