"use client";

import { useActionState, useState } from "react";
import { Button, Card, MoneyInput, parseRupeesToPaise, formatPaiseAsRupees, Input, Select, Textarea } from "@restrobooth/ui";
import { updateMenuItemDetails, type ActionState } from "../item-actions";

const initialState: ActionState = { error: null };

type Item = {
  id: string;
  name: string;
  description: string | null;
  basePricePaise: bigint;
  taxClassId: string;
  diet: string | null;
  status: string;
};

export function ItemDetailsForm({ item, taxClasses }: { item: Item; taxClasses: { id: string; code: string; rateBps: number }[] }) {
  const [state, formAction, pending] = useActionState(updateMenuItemDetails, initialState);
  const [priceRaw, setPriceRaw] = useState(formatPaiseAsRupees(item.basePricePaise));
  const paise = parseRupeesToPaise(priceRaw);

  return (
    <Card>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <input type="hidden" name="itemId" value={item.id} />

        <Input label="Name" name="name" defaultValue={item.name} required />
        <Textarea label="Description" name="description" defaultValue={item.description ?? ""} rows={3} />

        <MoneyInput label="Base price" valuePaise={item.basePricePaise} onChangePaise={(_p, raw) => setPriceRaw(raw)} />
        <input type="hidden" name="basePricePaise" value={paise !== null ? paise.toString() : ""} />

        <Select label="Tax class" name="taxClassId" defaultValue={item.taxClassId} required>
          {taxClasses.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} ({(t.rateBps / 100).toFixed(1)}%)
            </option>
          ))}
        </Select>

        <Select label="Diet" name="diet" defaultValue={item.diet ?? ""}>
          <option value="">Not specified</option>
          <option value="veg">Veg</option>
          <option value="non_veg">Non-veg</option>
          <option value="egg">Egg</option>
          <option value="jain">Jain</option>
        </Select>

        <Select label="Status" name="status" defaultValue={item.status}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </Select>

        {state.error && (
          <p role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
            {state.error}
          </p>
        )}

        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </Card>
  );
}
