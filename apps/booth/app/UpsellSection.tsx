import { getUpsellSuggestions } from "@restrobooth/ai";
import { Skeleton } from "@restrobooth/ui";
import { getDb } from "../lib/db";
import { UpsellRail } from "./UpsellRail";
import styles from "./UpsellRail.module.css";

/**
 * Owner decision, 2026-07-24: raising UPSELL_TIMEOUT_MS to 9s (from
 * 1200ms) so real AI reasons land more often meant this could no longer
 * live inline in page.tsx's own await chain — that would block the
 * WHOLE cart page (items, Place order, live order board) behind the AI
 * call every time a guest just opens their cart, not just the guest who
 * explicitly asked for recommendations (unlike Booth Host's intake,
 * nobody opts into waiting for this one). Split into its own async
 * Server Component specifically so <Suspense> can stream the rest of
 * the page immediately and this section in whenever it's ready — Next's
 * built-in streaming SSR, not client-side polling.
 */
export async function UpsellSection({
  storeId,
  outletId,
  cartMenuItemIds,
}: {
  storeId: string;
  outletId: string;
  cartMenuItemIds: string[];
}) {
  const upsell = await getUpsellSuggestions(getDb(), { storeId, outletId, cartMenuItemIds });
  if (!upsell || upsell.items.length === 0) return null;
  return <UpsellRail result={upsell} />;
}

/** Matches UpsellRail's real card shape so nothing jumps when the real
 *  section replaces this. */
export function UpsellSectionSkeleton() {
  return (
    <div className={styles.section}>
      <p className={styles.title}>Finding something to go with your meal…</p>
      <div className={styles.rail}>
        {[0, 1].map((i) => (
          <div key={i} className={styles.card}>
            <Skeleton width="60%" height="1.1em" />
            <Skeleton width="90%" />
            <div className={styles.footer}>
              <Skeleton width="40%" />
              <Skeleton width="100%" height="var(--touch-target)" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
