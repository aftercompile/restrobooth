import Link from "next/link";
import { formatPaiseAsRupees } from "@restrobooth/ui";
import type { BoothMenuItem } from "../lib/menu-queries";
import styles from "./Welcome.module.css";

/**
 * The first-visit hero — replaces the old plain EmptyOrderState. Renders
 * on the SAME existing condition that used to show EmptyOrderState (no
 * pending cart items, no fired/served items yet — apps/booth/app/page.tsx's
 * own branch on getGuestOrderStatus), not a new state: a returning guest
 * with anything already in progress skips straight past this to their
 * live order, exactly as before.
 *
 * "Today's picks" is real data — the same isPopular flag getBoothMenu()
 * computes from actual order_items history (apps/booth/lib/menu-queries.ts),
 * not an invented "trending" claim. Both CTAs land on /menu — "Help me
 * choose" isn't a different route, the AI intake already sits at the top
 * of that page; the two buttons are two honest framings of one
 * destination, not a promise of a separate flow that doesn't exist.
 */
export function Welcome({ brandName, popularItems }: { brandName: string; popularItems: BoothMenuItem[] }) {
  return (
    <div className={styles.hero}>
      <p className={styles.eyebrow}>Welcome to</p>
      <h1 className={styles.brand}>{brandName}</h1>
      <p className={styles.greeting}>Good to have you at our table today.</p>

      {popularItems.length > 0 && (
        <div className={styles.picks}>
          <p className={styles.picksLabel}>Popular today</p>
          <div className={styles.picksRail}>
            {popularItems.map((item) => (
              <div key={item.menuItemId} className={styles.pickCard}>
                <span className={styles.pickName}>{item.name}</span>
                <span className={styles.pickPrice}>₹{formatPaiseAsRupees(BigInt(item.pricePaise))}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <Link href="/menu" className={styles.primaryAction}>
          Explore the menu
        </Link>
        <Link href="/menu" className={styles.secondaryAction}>
          Help me choose
        </Link>
      </div>
    </div>
  );
}
