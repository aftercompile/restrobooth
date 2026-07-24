"use client";

import { useState, useTransition } from "react";
import { Animate, useToast, formatPaiseAsRupees } from "@restrobooth/ui";
import { addToCartAction } from "../actions";
import type { BoothHostResult } from "../../lib/booth-host";
import styles from "./PickedForYouRail.module.css";

/** Renders the Booth Host's shortlist — ADR-0007 §5A's "Picked for you"
 *  rail, titled "✨ Picked just for you" since this one genuinely IS
 *  personalised to the guest's own intake answers (unlike Welcome's
 *  "Popular picks", which is real aggregate popularity, not AI-personalised
 *  — the two are deliberately worded differently so neither claims more
 *  than it is). `result.aiUsed` is intentionally NOT shown to the guest
 *  (whether the reason came from the LLM or the deterministic fallback
 *  template is an internal/eval concern, not something a guest needs to
 *  see) — both paths are designed to read as genuinely useful. */
export function PickedForYouRail({ result, onDismiss }: { result: BoothHostResult; onDismiss: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);

  function handleAdd(item: BoothHostResult["items"][number]) {
    setPendingId(item.menuItemId);
    startTransition(async () => {
      const res = await addToCartAction(item.menuItemId);
      if (res.error) toast(res.error, "critical");
      else toast(`Added to your table`, "neutral");
      setPendingId(null);
    });
  }

  if (result.items.length === 0) {
    return (
      <Animate>
        <div className={styles.empty}>
          <p className={styles.emptyText}>
            Nothing quite matched that combination — browse the full menu below, we&apos;re sure you&apos;ll find something great.
          </p>
          <button type="button" className={styles.dismiss} onClick={onDismiss}>
            Got it
          </button>
        </div>
      </Animate>
    );
  }

  return (
    <Animate>
      <div className={styles.section}>
        <div className={styles.header}>
          <p className={styles.title}>✨ Picked just for you</p>
          <button type="button" className={styles.dismiss} onClick={onDismiss}>
            Hide
          </button>
        </div>
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
    </Animate>
  );
}
