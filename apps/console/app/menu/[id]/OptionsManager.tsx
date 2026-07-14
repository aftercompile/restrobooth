"use client";

import { useActionState, useState } from "react";
import { Badge, Button, Card, DataRow, Input, MoneyInput, parseRupeesToPaise, Select, TabularNumber } from "@restrobooth/ui";
import { addOptionGroup, addOptionItem, type ActionState } from "../item-actions";

const initialState: ActionState = { error: null };

type OptionGroup = { id: string; name: string; kind: string; minSelect: number; maxSelect: number };
type OptionItem = { id: string; optionGroupId: string; name: string; pricePaise: bigint };

export function OptionsManager({
  itemId,
  optionGroups,
  optionItems,
}: {
  itemId: string;
  optionGroups: OptionGroup[];
  optionItems: OptionItem[];
}) {
  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {optionGroups.map((group) => (
          <div key={group.id}>
            <DataRow
              label={<strong>{group.name}</strong>}
              trailing={<Badge tone="neutral">{group.kind === "variant" ? "pick one" : `${group.minSelect}-${group.maxSelect}`}</Badge>}
            />
            {optionItems
              .filter((o) => o.optionGroupId === group.id)
              .map((o) => (
                <DataRow key={o.id} label={o.name} trailing={<TabularNumber>₹{(Number(o.pricePaise) / 100).toFixed(2)}</TabularNumber>} />
              ))}
            <AddOptionItemForm itemId={itemId} optionGroupId={group.id} />
          </div>
        ))}
        {optionGroups.length === 0 && (
          <p style={{ fontSize: "var(--text-sm)", opacity: 0.6 }}>No variants or add-ons yet.</p>
        )}
        <AddOptionGroupForm itemId={itemId} />
      </div>
    </Card>
  );
}

function AddOptionGroupForm({ itemId }: { itemId: string }) {
  const [state, formAction, pending] = useActionState(addOptionGroup, initialState);
  const [kind, setKind] = useState("variant");

  return (
    <form action={formAction} style={{ display: "flex", gap: "var(--space-1)", alignItems: "flex-end", flexWrap: "wrap" }}>
      <input type="hidden" name="itemId" value={itemId} />
      <Select label="Kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="variant">Variant (pick one)</option>
        <option value="addon">Add-on (pick some)</option>
      </Select>
      <Input label="Group name" name="name" placeholder="Size" required />
      {kind === "addon" && (
        <>
          <Input label="Min" name="minSelect" type="number" defaultValue={0} min={0} style={{ width: 64 }} />
          <Input label="Max" name="maxSelect" type="number" defaultValue={1} min={0} style={{ width: 64 }} />
        </>
      )}
      <Button type="submit" variant="secondary" disabled={pending}>
        Add group
      </Button>
      {state.error && (
        <span role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}

function AddOptionItemForm({ itemId, optionGroupId }: { itemId: string; optionGroupId: string }) {
  const [state, formAction, pending] = useActionState(addOptionItem, initialState);
  const [priceRaw, setPriceRaw] = useState("");
  const paise = parseRupeesToPaise(priceRaw);

  return (
    <form action={formAction} style={{ display: "flex", gap: "var(--space-1)", alignItems: "flex-end", paddingLeft: "var(--space-2)" }}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="optionGroupId" value={optionGroupId} />
      <Input label="Option name" name="name" placeholder="Half" required />
      <MoneyInput label="Price" valuePaise={null} onChangePaise={(_p, raw) => setPriceRaw(raw)} />
      <input type="hidden" name="pricePaise" value={paise !== null ? paise.toString() : ""} />
      <Button type="submit" variant="secondary" disabled={pending}>
        Add
      </Button>
      {state.error && (
        <span role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
