"use client";

import { useState, useTransition } from "react";
import { useToast } from "@restrobooth/ui";
import type { UpsellResult } from "@restrobooth/ai";
import { addOrderItem } from "./actions";
import styles from "./UpsellStrip.module.css";

function formatRupees(paise: string): string {
  const n = BigInt(paise);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

/** RESTROBOOTH_BRIEF.md §5E — "goes well with" on the captain app. Same
 *  numbers/reasons as the Booth cart's UpsellRail (packages/ai/src/upsell.ts
 *  is the shared source), just laid out as a compact list to match this
 *  app's own list-based UI rather than a card rail. */
export function UpsellStrip({ sessionId, result }: { sessionId: string; result: UpsellResult }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (result.items.length === 0) return null;

  function handleAdd(item: UpsellResult["items"][number]) {
    setPendingId(item.menuItemId);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("sessionId", sessionId);
      formData.set("menuItemId", item.menuItemId);
      formData.set("quantity", "1");
      const result = await addOrderItem({ error: null }, formData);
      if (result.error) toast(result.error, "critical");
      setPendingId(null);
    });
  }

  return (
    <>
      <p className={styles.sectionTitle}>Suggested</p>
      <div className={styles.list}>
        {result.items.map((item) => (
          <div key={item.menuItemId} className={styles.row}>
            <div className={styles.info}>
              <span className={styles.itemName}>{item.name}</span>
              <span className={styles.reason}>{item.reason}</span>
            </div>
            <span className={styles.itemPrice}>₹{formatRupees(item.pricePaise)}</span>
            <button
              type="button"
              className={styles.addButton}
              disabled={pending && pendingId === item.menuItemId}
              onClick={() => handleAdd(item)}
            >
              Add
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
