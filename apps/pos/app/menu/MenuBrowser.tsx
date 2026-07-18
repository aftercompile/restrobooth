"use client";

import { useActionState, useMemo } from "react";
import { Button, Card, CardHeader, DataRow } from "@restrobooth/ui";
import { setAvailability, type ActionState } from "./actions";
import type { MenuOverviewItem } from "./queries";
import styles from "./MenuBrowser.module.css";

const INITIAL: ActionState = { error: null };

const DIET_LABEL: Record<string, string> = {
  veg: "Veg",
  non_veg: "Non-veg",
  egg: "Egg",
  jain: "Jain",
};

function formatRupees(paise: string): string {
  const n = BigInt(paise);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}

export function MenuBrowser({ items }: { items: MenuOverviewItem[] }) {
  const byOutlet = useMemo(() => {
    const outlets = new Map<
      string,
      { outletName: string; stores: Map<string, { storeId: string; brandName: string; categories: Map<string, MenuOverviewItem[]> }> }
    >();
    for (const item of items) {
      let outlet = outlets.get(item.outletId);
      if (!outlet) {
        outlet = { outletName: item.outletName, stores: new Map() };
        outlets.set(item.outletId, outlet);
      }
      let store = outlet.stores.get(item.storeId);
      if (!store) {
        store = { storeId: item.storeId, brandName: item.brandName, categories: new Map() };
        outlet.stores.set(item.storeId, store);
      }
      const categoryKey = item.categoryName ?? "Uncategorised";
      const bucket = store.categories.get(categoryKey);
      if (bucket) bucket.push(item);
      else store.categories.set(categoryKey, [item]);
    }
    return outlets;
  }, [items]);

  const unavailableCount = items.filter((i) => !i.isAvailable).length;

  if (items.length === 0) {
    return <p className={styles.empty}>No menu items at any store you have access to.</p>;
  }

  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>Menu</h1>
        <span className={styles.counts}>
          {items.length} item{items.length === 1 ? "" : "s"}
          {unavailableCount > 0 ? ` · ${unavailableCount} unavailable` : ""}
        </span>
      </div>

      {Array.from(byOutlet.values()).map((outlet) => (
        <div key={outlet.outletName} className={styles.outlet}>
          <p className={styles.outletName}>{outlet.outletName}</p>
          {Array.from(outlet.stores.values()).map((store) => (
            <div key={store.storeId} className={styles.store}>
              {/* The brand name only earns its own line at a cloud kitchen —
                  a single-brand outlet would just be repeating the outlet
                  name, so it's a sub-heading, not promoted to the same
                  level. */}
              <p className={styles.brandName}>{store.brandName}</p>
              {Array.from(store.categories.entries()).map(([categoryName, categoryItems]) => (
                <Card key={categoryName} padded={false}>
                  <CardHeader title={categoryName} count={categoryItems.length} />
                  {categoryItems.map((item) => (
                    <MenuItemRow key={item.menuItemId} item={item} />
                  ))}
                </Card>
              ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

function MenuItemRow({ item }: { item: MenuOverviewItem }) {
  const [state, formAction, pending] = useActionState(setAvailability, INITIAL);

  return (
    <DataRow
      railState={item.isAvailable ? "fresh" : "archived"}
      railLabel={item.isAvailable ? "Available" : "86'd — unavailable"}
      muted={!item.isAvailable}
      label={
        <>
          {item.name}
          {item.diet && <span className={styles.diet}> · {DIET_LABEL[item.diet] ?? item.diet}</span>}
        </>
      }
      trailing={
        <div className={styles.trailing}>
          <span className={styles.price}>₹{formatRupees(item.pricePaise)}</span>
          <form action={formAction}>
            <input type="hidden" name="itemId" value={item.menuItemId} />
            <input type="hidden" name="storeId" value={item.storeId} />
            <input type="hidden" name="isAvailable" value={String(!item.isAvailable)} />
            <Button type="submit" variant={item.isAvailable ? "danger" : "secondary"} className={styles.toggleButton} disabled={pending}>
              {pending ? "…" : item.isAvailable ? "86 it" : "Un-86"}
            </Button>
          </form>
          {state.error && <span className={styles.error}>{state.error}</span>}
        </div>
      }
    />
  );
}
