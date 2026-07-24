"use client";

import { Badge, formatPaiseAsRupees, motion, useMotionAllowed } from "@restrobooth/ui";
import type { BoothMenuItem } from "../../lib/menu-queries";
import { MenuItemArt } from "../MenuItemArt";
import styles from "./MenuItemCard.module.css";

const DIET_LABEL: Record<string, string> = {
  veg: "Veg",
  non_veg: "Non-veg",
  egg: "Contains egg",
  jain: "Jain",
};

/**
 * The redesigned menu card — art, name/description/price, and a badge
 * row built ONLY from real menu_items columns (diet, spice_level,
 * isPopular from getBoothMenu's real order-history subquery, and
 * isChefSignature from the existing "signature" tag). No calories or
 * prep-time badge here — none of that data exists per-item (CLAUDE.md:
 * never build UI against invented data). Whole card opens the
 * item-detail sheet; the Add button on it stops propagation so a quick
 * add doesn't also pop the sheet open underneath it.
 *
 * Two rows, not one 3-column row: art+name/badges on top, description
 * and the price/Add footer each get the FULL card width below. A single
 * row with art + text + price + button squeezed side by side left the
 * description column ~90px wide on a phone — enough for 3-4 characters
 * per line before wrapping, which read as broken, not truncated.
 *
 * `justAdded` briefly swaps the button to a confirmation state (set by
 * the caller from its own click handler, cleared by its own setTimeout —
 * never a useEffect here) — a satisfying "this worked" beat that doesn't
 * depend on the guest noticing a toast. `whileTap` is framer-motion's
 * own built-in gesture prop, not manual animation state, so it costs
 * nothing extra to gate on useMotionAllowed().
 */
export function MenuItemCard({
  item,
  onOpenDetail,
  onQuickAdd,
  adding,
  justAdded,
}: {
  item: BoothMenuItem;
  onOpenDetail: () => void;
  onQuickAdd: () => void;
  adding: boolean;
  justAdded: boolean;
}) {
  const motionAllowed = useMotionAllowed();
  const showSpice = item.spiceLevel === "medium" || item.spiceLevel === "hot";

  const addButtonProps = {
    type: "button" as const,
    "aria-label": `Add ${item.name}`,
    className: styles.addButton,
    "data-added": justAdded,
    disabled: adding,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onQuickAdd();
    },
  };
  const addButtonLabel = adding ? "…" : justAdded ? "✓ Added" : "Add";

  // A real <button> can't nest another interactive element (the browser's
  // HTML parser silently breaks nested buttons) — the card itself is a
  // div with button semantics instead, so the Add button inside it stays
  // a genuine, independently-focusable <button>.
  return (
    <div
      className={styles.card}
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
    >
      <div className={styles.top}>
        <MenuItemArt imageUrl={item.imageUrl} categoryName={item.categoryName} />
        <div className={styles.info}>
          <p className={styles.name}>{item.name}</p>
          <div className={styles.badges}>
            {item.isChefSignature && <Badge tone="warning">✨ Chef&apos;s Signature</Badge>}
            {item.isPopular && <Badge tone="live">Popular</Badge>}
            {item.diet && <Badge tone="neutral">{DIET_LABEL[item.diet] ?? item.diet}</Badge>}
            {showSpice && <Badge tone="warning">{item.spiceLevel === "hot" ? "🌶️ Hot" : "🌶️ Medium"}</Badge>}
          </div>
        </div>
      </div>

      {item.description && <p className={styles.description}>{item.description}</p>}

      <div className={styles.footer}>
        <span className={styles.price}>₹{formatPaiseAsRupees(BigInt(item.pricePaise))}</span>
        {motionAllowed ? (
          <motion.button {...addButtonProps} whileTap={{ scale: 0.9 }}>
            {addButtonLabel}
          </motion.button>
        ) : (
          <button {...addButtonProps}>{addButtonLabel}</button>
        )}
      </div>
    </div>
  );
}
