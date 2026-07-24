"use client";

import { Badge, formatPaiseAsRupees } from "@restrobooth/ui";
import type { BoothMenuItem } from "../../lib/menu-queries";
import styles from "./MenuItemCard.module.css";

const DIET_LABEL: Record<string, string> = {
  veg: "Veg",
  non_veg: "Non-veg",
  egg: "Contains egg",
  jain: "Jain",
};

/**
 * The redesigned menu card — name/description/price plus a badge row
 * built ONLY from real menu_items columns (diet, spice_level, and
 * isPopular from getBoothMenu's real order-history subquery). No
 * calories, prep-time, or image — none of that data exists (CLAUDE.md:
 * never build UI against invented data). Whole card opens the item-detail
 * sheet; the Add button on it stops propagation so a quick add doesn't
 * also pop the sheet open underneath it.
 */
export function MenuItemCard({
  item,
  onOpenDetail,
  onQuickAdd,
  adding,
}: {
  item: BoothMenuItem;
  onOpenDetail: () => void;
  onQuickAdd: () => void;
  adding: boolean;
}) {
  const showSpice = item.spiceLevel === "medium" || item.spiceLevel === "hot";

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
      <div className={styles.info}>
        <p className={styles.name}>{item.name}</p>
        {item.description && <p className={styles.description}>{item.description}</p>}
        <div className={styles.badges}>
          {item.isPopular && <Badge tone="live">Popular</Badge>}
          {item.diet && <Badge tone="neutral">{DIET_LABEL[item.diet] ?? item.diet}</Badge>}
          {showSpice && <Badge tone="warning">{item.spiceLevel === "hot" ? "🌶️ Hot" : "🌶️ Medium"}</Badge>}
        </div>
      </div>
      <div className={styles.trailing}>
        <span className={styles.price}>₹{formatPaiseAsRupees(BigInt(item.pricePaise))}</span>
        <button
          type="button"
          aria-label={`Add ${item.name}`}
          className={styles.addButton}
          disabled={adding}
          onClick={(e) => {
            e.stopPropagation();
            onQuickAdd();
          }}
        >
          {adding ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}
