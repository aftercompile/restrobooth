import { getUpsellSuggestions } from "@restrobooth/ai";
import { Skeleton } from "@restrobooth/ui";
import { getDb } from "../../../lib/db";
import { UpsellStrip } from "./UpsellStrip";
import styles from "./UpsellStrip.module.css";

/**
 * Owner decision, 2026-07-24: raising the shared UPSELL_TIMEOUT_MS to 9s
 * (packages/ai/src/upsell.ts) alongside the Booth Host meant this could
 * no longer block the whole order screen the way it used to — same
 * reasoning as apps/booth/app/UpsellSection.tsx, applied here since this
 * screen shares the identical `getUpsellSuggestions` call and budget.
 * Streamed in via <Suspense> (OrderScreen.tsx's `upsellSlot` prop),
 * never blocking the order/menu/KOT content that's already ready.
 */
export async function UpsellSection({
  sessionId,
  storeId,
  outletId,
  cartMenuItemIds,
}: {
  sessionId: string;
  storeId: string;
  outletId: string;
  cartMenuItemIds: string[];
}) {
  const upsell = await getUpsellSuggestions(getDb(), { storeId, outletId, cartMenuItemIds });
  if (!upsell || upsell.items.length === 0) return null;
  return <UpsellStrip sessionId={sessionId} result={upsell} />;
}

/** Captain is in `lint-motion`'s no-framer-motion set (CLAUDE.md — zero
 *  motion on POS/KDS/Captain working content), so this is plain CSS only
 *  — `Skeleton`'s own shimmer is CSS, not framer-motion, so it's safe
 *  here same as everywhere else. */
export function UpsellSectionSkeleton() {
  return (
    <div>
      <p className={styles.sectionTitle}>Loading suggestions…</p>
      <div className={styles.list}>
        {[0, 1].map((i) => (
          <div key={i} className={styles.row}>
            <div className={styles.info}>
              <Skeleton width="50%" height="1em" />
              <Skeleton width="70%" />
            </div>
            <Skeleton width="60px" height="40px" />
          </div>
        ))}
      </div>
    </div>
  );
}
