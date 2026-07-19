"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Animate, useToast, formatPaiseAsRupees } from "@restrobooth/ui";
import type { BoothMenuItem } from "../../lib/menu-queries";
import { addToCartAction } from "../actions";
import styles from "./MenuBrowser.module.css";

/** Same tap-to-add pattern as apps/captain's AddItemPicker.tsx — always
 *  +1 per tap, no stepper (matches this design system's established
 *  quantity UX everywhere else). */
export function MenuBrowser({ groups, cartCount }: { groups: [string, BoothMenuItem[]][]; cartCount: number }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  function handleAdd(item: BoothMenuItem) {
    setPendingItemId(item.menuItemId);
    startTransition(async () => {
      const result = await addToCartAction(item.menuItemId);
      if (result.error) toast(result.error, "critical");
      else toast(`Added ${item.name}`, "neutral");
      setPendingItemId(null);
    });
  }

  return (
    <>
      <div className={styles.list}>
        {groups.map(([categoryName, items], gi) => (
          <Animate key={categoryName} delayIndex={gi}>
            <div className={styles.category}>
              <p className={styles.categoryName}>{categoryName}</p>
              {items.map((item) => (
                <button
                  key={item.menuItemId}
                  type="button"
                  className={styles.itemButton}
                  disabled={pending && pendingItemId === item.menuItemId}
                  onClick={() => handleAdd(item)}
                >
                  <span className={styles.itemName}>{item.name}</span>
                  <span className={styles.itemPrice}>₹{formatPaiseAsRupees(BigInt(item.pricePaise))}</span>
                </button>
              ))}
            </div>
          </Animate>
        ))}
      </div>

      {cartCount > 0 && (
        <Link href="/" className={styles.cartBar}>
          {cartCount} item{cartCount === 1 ? "" : "s"} in your order · View order →
        </Link>
      )}
    </>
  );
}
