"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Card, DataRow, MoneyInput, parseRupeesToPaise, Select, TabularNumber } from "@restrobooth/ui";
import { publishPriceOverride, setAvailability, type ActionState } from "../item-actions";

const initialState: ActionState = { error: null };

type Store = { id: string; outletName: string };
type Override = {
  id: string;
  storeId: string | null;
  pricePaise: bigint | null;
  isAvailable: boolean | null;
  publishedAt: Date | null;
};

export function OverrideActions({ itemId, stores, overrides }: { itemId: string; stores: Store[]; overrides: Override[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");

  // Most recent published row per field, per store — mirrors resolve_menu()'s
  // "price and availability resolve independently" rule at a glance, for
  // just this one store's overrides (channel/daypart/promo dimensions are
  // out of scope for this Phase 2 slice — see the catalog schema's own
  // comment on why).
  const latestPriceForStore = [...overrides].reverse().find((o) => o.storeId === storeId && o.pricePaise !== null);
  const latestAvailabilityForStore = [...overrides].reverse().find((o) => o.storeId === storeId && o.isAvailable !== null);

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Select label="Store" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.outletName}
            </option>
          ))}
        </Select>

        <DataRow
          label="Current price override"
          trailing={
            latestPriceForStore ? <TabularNumber>₹{(Number(latestPriceForStore.pricePaise) / 100).toFixed(2)}</TabularNumber> : <span>brand default</span>
          }
        />
        <DataRow
          label="Current availability"
          trailing={
            <Badge tone={latestAvailabilityForStore?.isAvailable === false ? "critical" : "live"}>
              {latestAvailabilityForStore?.isAvailable === false ? "86'd" : "available"}
            </Badge>
          }
        />

        <PriceForm itemId={itemId} storeId={storeId} />
        <AvailabilityForm itemId={itemId} storeId={storeId} currentlyAvailable={latestAvailabilityForStore?.isAvailable !== false} />
      </div>
    </Card>
  );
}

function PriceForm({ itemId, storeId }: { itemId: string; storeId: string }) {
  const [state, formAction, pending] = useActionState(publishPriceOverride, initialState);
  const [priceRaw, setPriceRaw] = useState("");
  const paise = parseRupeesToPaise(priceRaw);

  return (
    <form action={formAction} style={{ display: "flex", gap: "var(--space-1)", alignItems: "flex-end" }}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="storeId" value={storeId} />
      <MoneyInput label="New price for this store" valuePaise={null} onChangePaise={(_p, raw) => setPriceRaw(raw)} />
      <input type="hidden" name="pricePaise" value={paise !== null ? paise.toString() : ""} />
      <Button type="submit" variant="primary" disabled={pending || paise === null}>
        {pending ? "Publishing…" : "Publish price"}
      </Button>
      {state.error && (
        <span role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}

function AvailabilityForm({ itemId, storeId, currentlyAvailable }: { itemId: string; storeId: string; currentlyAvailable: boolean }) {
  const [state, formAction, pending] = useActionState(setAvailability, initialState);

  return (
    <form action={formAction} style={{ display: "flex", gap: "var(--space-1)", alignItems: "center" }}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="storeId" value={storeId} />
      <input type="hidden" name="isAvailable" value={currentlyAvailable ? "false" : "true"} />
      <Button type="submit" variant={currentlyAvailable ? "danger" : "secondary"} disabled={pending}>
        {pending ? "Saving…" : currentlyAvailable ? "86 this item" : "Mark available"}
      </Button>
      {state.error && (
        <span role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
