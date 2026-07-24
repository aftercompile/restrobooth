import Link from "next/link";
import { formatPaiseAsRupees } from "@restrobooth/ui";
import type { BoothMenuItem } from "../lib/menu-queries";
import { MenuItemArt } from "./MenuItemArt";
import styles from "./Welcome.module.css";

/** IST explicitly, not server-local time — this app assumes an Indian
 *  outlet throughout (GST, UPI, business_date), but a live Vercel
 *  function's own clock is UTC, so a raw `new Date().getHours()` would
 *  greet a guest "Good evening" at 2pm IST. No per-outlet timezone
 *  column exists to do this more precisely; Asia/Kolkata is the same
 *  fixed assumption the rest of the domain already makes. */
function getGreeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * The first-visit hero — replaces the old plain EmptyOrderState. Renders
 * on the SAME existing condition that used to show EmptyOrderState (no
 * pending cart items, no fired/served items yet — apps/booth/app/page.tsx's
 * own branch on getGuestOrderStatus), not a new state: a returning guest
 * with anything already in progress skips straight past this to their
 * live order, exactly as before.
 *
 * "Popular picks" is real data — the same isPopular flag getBoothMenu()
 * computes from actual order_items history (apps/booth/lib/menu-queries.ts),
 * deliberately NOT relabelled as AI-personalised ("Picked just for you")
 * since it isn't personalised — it's real aggregate popularity, and
 * calling it AI-picked would be exactly the kind of claim CLAUDE.md's
 * honest-data rule rules out. Both CTAs land on /menu — the AI intake
 * already sits at the top of that page; the two buttons are two honest
 * framings of one destination, not a promise of a separate flow.
 */
export function Welcome({ brandName, popularItems }: { brandName: string; popularItems: BoothMenuItem[] }) {
  return (
    <div className={styles.hero}>
      <p className={styles.eyebrow}>{getGreeting()}, welcome to</p>
      <h1 className={styles.brand}>{brandName}</h1>
      <p className={styles.greeting}>Your personal dining assistant is here to help you discover something great.</p>

      {popularItems.length > 0 && (
        <div className={styles.picks}>
          <p className={styles.picksLabel}>⭐ Popular picks</p>
          <div className={styles.picksRail}>
            {popularItems.map((item) => (
              <div key={item.menuItemId} className={styles.pickCard}>
                <MenuItemArt imageUrl={item.imageUrl} categoryName={item.categoryName} />
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
          ✨ Let our AI recommend your meal
        </Link>
      </div>
    </div>
  );
}
