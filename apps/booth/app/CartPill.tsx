"use client";

import Link from "next/link";
import { formatPaiseAsRupees, motion, useMotionAllowed } from "@restrobooth/ui";
import styles from "./CartPill.module.css";

/**
 * The persistent cart affordance — replaces MenuBrowser's old plain
 * cartBar Link. Same destination (`/`, the order/cart screen — routing
 * unchanged) and same underlying count/total (apps/booth/lib/order-queries.ts's
 * GuestOrderItem, pending items only), just always-visible instead of a
 * bar that only appeared beneath the last category.
 *
 * The count badge remounts (via `key={count}`) and briefly pops on every
 * change — the same "changed key -> fresh entrance animation" trick
 * OrderStatusBoard's own status-flip already uses, not a useEffect+timer
 * (which would just re-trigger the cascading-render lint issue
 * ItemDetailSheet's own comment already documents a fix for). No manual
 * timing logic needed: the animation plays once per mount and settles on
 * its own.
 */
export function CartPill({ count, totalPaise }: { count: number; totalPaise: bigint }) {
  const motionAllowed = useMotionAllowed();
  if (count === 0) return null;

  const countBadge = motionAllowed ? (
    <motion.span
      key={count}
      className={styles.count}
      initial={{ scale: 1.5 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 500, damping: 15 }}
    >
      {count}
    </motion.span>
  ) : (
    <span className={styles.count}>{count}</span>
  );

  return (
    <Link href="/" className={styles.pill}>
      {countBadge}
      <span className={styles.label}>View order</span>
      <span className={styles.total}>₹{formatPaiseAsRupees(totalPaise)}</span>
    </Link>
  );
}
