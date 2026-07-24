"use client";

import { useState } from "react";
import { Badge, BottomSheet, Button, QuantityStepper, formatPaiseAsRupees } from "@restrobooth/ui";
import type { BoothMenuItem } from "../../lib/menu-queries";
import { MenuItemArt } from "../MenuItemArt";
import styles from "./ItemDetailSheet.module.css";

const DIET_LABEL: Record<string, string> = {
  veg: "Veg",
  non_veg: "Non-veg",
  egg: "Contains egg",
  jain: "Jain",
};

/**
 * The premium item-detail surface (packages/ui's new BottomSheet). No
 * customization/add-ons section — that data doesn't exist in the schema
 * (no add-on/modifier tables), so it's omitted rather than faked. Adding
 * N quantity calls the existing addToCartAction N times (order_items has
 * no native "add 3 of the same line" batch mutation — same one-tap-per-
 * unit contract MenuBrowser's quick-add already relies on), sequentially
 * so the toast/error handling stays simple and matches every other
 * add-to-cart path in this app.
 */
export function ItemDetailSheet({
  item,
  onClose,
  onAdd,
}: {
  item: BoothMenuItem | null;
  onClose: () => void;
  onAdd: (item: BoothMenuItem, quantity: number) => Promise<void>;
}) {
  // React's own documented "adjusting state during render" pattern
  // (react.dev — a deliberate, blessed exception to "don't call setState
  // during render," distinct from doing it in an effect, which is why
  // this doesn't trip react-hooks/set-state-in-effect): once `item` goes
  // null (closing), the sheet's CONTENT needs to keep showing the item
  // that was open a moment ago, or it would blank out instantly while
  // BottomSheet's exit animation is still sliding the (now-empty) panel
  // away. `open` still tracks the real `item` so the animation itself is
  // correct either way.
  const [prevItem, setPrevItem] = useState(item);
  const [displayItem, setDisplayItem] = useState(item);
  if (item !== prevItem) {
    setPrevItem(item);
    if (item) setDisplayItem(item);
  }

  return (
    <BottomSheet open={item !== null} onClose={onClose} {...(displayItem ? { title: displayItem.name } : {})}>
      {/* Keyed by item id, not reset via an effect: a fresh mount per item
          gives each one its own quantity/adding state starting at 1 for
          free. */}
      {displayItem && <ItemDetailContent key={displayItem.menuItemId} item={displayItem} onAdd={onAdd} />}
    </BottomSheet>
  );
}

function ItemDetailContent({
  item,
  onAdd,
}: {
  item: BoothMenuItem;
  onAdd: (item: BoothMenuItem, quantity: number) => Promise<void>;
}) {
  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    setAdding(true);
    await onAdd(item, quantity);
    setAdding(false);
  }

  return (
    <div className={styles.content}>
      <MenuItemArt imageUrl={item.imageUrl} categoryName={item.categoryName} size="sheet" />

      {item.description && <p className={styles.description}>{item.description}</p>}

      <div className={styles.badges}>
        {item.isChefSignature && <Badge tone="warning">✨ Chef&apos;s Signature</Badge>}
        {item.isPopular && <Badge tone="live">Popular</Badge>}
        {item.diet && <Badge tone="neutral">{DIET_LABEL[item.diet] ?? item.diet}</Badge>}
        {(item.spiceLevel === "medium" || item.spiceLevel === "hot") && (
          <Badge tone="warning">{item.spiceLevel === "hot" ? "🌶️ Hot" : "🌶️ Medium"}</Badge>
        )}
      </div>

      {item.allergens.length > 0 && <p className={styles.allergens}>Contains: {item.allergens.join(", ")}</p>}

      <div className={styles.footer}>
        <QuantityStepper quantity={quantity} onDecrease={() => setQuantity((q) => Math.max(1, q - 1))} onIncrease={() => setQuantity((q) => q + 1)} />
        <Button type="button" variant="primary" className={styles.addButton} disabled={adding} onClick={handleAdd}>
          {adding ? "Adding…" : `Add · ₹${formatPaiseAsRupees(BigInt(item.pricePaise) * BigInt(quantity))}`}
        </Button>
      </div>
    </div>
  );
}
