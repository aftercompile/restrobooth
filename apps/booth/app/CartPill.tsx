"use client";

import Link from "next/link";
import { formatPaiseAsRupees } from "@restrobooth/ui";
import styles from "./CartPill.module.css";

/**
 * The persistent cart affordance — replaces MenuBrowser's old plain
 * cartBar Link. Same destination (`/`, the order/cart screen — routing
 * unchanged) and same underlying count/total (apps/booth/lib/order-queries.ts's
 * GuestOrderItem, pending items only), just always-visible instead of a
 * bar that only appeared beneath the last category.
 */
export function CartPill({ count, totalPaise }: { count: number; totalPaise: bigint }) {
  if (count === 0) return null;

  return (
    <Link href="/" className={styles.pill}>
      <span className={styles.count}>{count}</span>
      <span className={styles.label}>View order</span>
      <span className={styles.total}>₹{formatPaiseAsRupees(totalPaise)}</span>
    </Link>
  );
}
