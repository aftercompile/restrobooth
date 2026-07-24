"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Animate, Chip, useToast } from "@restrobooth/ui";
import type { BoothMenuItem } from "../../lib/menu-queries";
import type { GuestOrderItem } from "../../lib/order-queries";
import { addToCartAction } from "../actions";
import { CartPill } from "../CartPill";
import { MenuItemCard } from "./MenuItemCard";
import { ItemDetailSheet } from "./ItemDetailSheet";
import styles from "./MenuBrowser.module.css";

/**
 * The menu centerpiece: a sticky, scroll-spied category chip bar over
 * refined item cards, a whole-card tap opening the item-detail bottom
 * sheet, and a persistent cart pill replacing the old bottom cartBar
 * link. Add-to-cart still goes through the same addToCartAction every
 * other Booth surface uses — the redesign changes presentation only.
 */
export function MenuBrowser({ groups, cartItems }: { groups: [string, BoothMenuItem[]][]; cartItems: GuestOrderItem[] }) {
  const toast = useToast();
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<BoothMenuItem | null>(null);
  const [activeCategory, setActiveCategory] = useState(groups[0]?.[0] ?? "");

  const sectionRefs = useRef(new Map<string, HTMLDivElement>());

  const cartCount = cartItems.length;
  const cartTotalPaise = useMemo(
    () => cartItems.reduce((sum, i) => sum + BigInt(i.unitPricePaise) * BigInt(i.quantity), 0n),
    [cartItems],
  );

  // Scroll-spy: a section counts as "active" once its top has crossed
  // just below the sticky header+chip bar — rootMargin's negative top
  // matches that combined height (56px header + ~52px chip bar), and the
  // large negative bottom keeps only sections near the top of the
  // viewport eligible, not everything currently on screen.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const category = topmost.target.getAttribute("data-category");
        if (category) setActiveCategory(category);
      },
      { rootMargin: "-108px 0px -70% 0px", threshold: 0 },
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, [groups]);

  function scrollToCategory(category: string) {
    sectionRefs.current.get(category)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleQuickAdd(item: BoothMenuItem) {
    setPendingItemId(item.menuItemId);
    addToCartAction(item.menuItemId)
      .then((result) => {
        if (result.error) {
          toast(result.error, "critical");
          return;
        }
        toast(`Added to your table`, "neutral");
        // A brief "✓ Added" on the button itself, not just the toast —
        // set from this event handler (not an effect), so the timer
        // cleanup here never trips react-hooks/set-state-in-effect.
        setJustAddedId(item.menuItemId);
        setTimeout(() => setJustAddedId((current) => (current === item.menuItemId ? null : current)), 1200);
      })
      .finally(() => setPendingItemId(null));
  }

  async function handleDetailAdd(item: BoothMenuItem, quantity: number) {
    for (let i = 0; i < quantity; i++) {
      const result = await addToCartAction(item.menuItemId);
      if (result.error) {
        toast(result.error, "critical");
        setDetailItem(null);
        return;
      }
    }
    toast(quantity === 1 ? "Added to your table" : `Added ${quantity} to your table`, "neutral");
    setDetailItem(null);
  }

  return (
    <>
      <div className={styles.chipBar}>
        {groups.map(([categoryName]) => (
          <Chip key={categoryName} selected={categoryName === activeCategory} onToggle={() => scrollToCategory(categoryName)}>
            {categoryName}
          </Chip>
        ))}
      </div>

      <div className={styles.list}>
        {groups.map(([categoryName, items], gi) => (
          <div
            key={categoryName}
            data-category={categoryName}
            ref={(el) => {
              if (el) sectionRefs.current.set(categoryName, el);
              else sectionRefs.current.delete(categoryName);
            }}
            className={styles.category}
          >
            <Animate delayIndex={gi}>
              <p className={styles.categoryName}>{categoryName}</p>
            </Animate>
            <div className={styles.cards}>
              {items.map((item) => (
                <MenuItemCard
                  key={item.menuItemId}
                  item={item}
                  adding={pendingItemId === item.menuItemId}
                  justAdded={justAddedId === item.menuItemId}
                  onOpenDetail={() => setDetailItem(item)}
                  onQuickAdd={() => handleQuickAdd(item)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <ItemDetailSheet item={detailItem} onClose={() => setDetailItem(null)} onAdd={handleDetailAdd} />
      <CartPill count={cartCount} totalPaise={cartTotalPaise} />
    </>
  );
}
