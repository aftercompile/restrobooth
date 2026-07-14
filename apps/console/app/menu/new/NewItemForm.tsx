"use client";

import { useActionState, useState } from "react";
import { Button, Input, MoneyInput, parseRupeesToPaise, Select, Textarea } from "@restrobooth/ui";
import { createMenuItem, type ActionState } from "../item-actions";

const initialState: ActionState = { error: null };

export function NewItemForm({
  brands,
  categories,
  taxClasses,
}: {
  brands: { id: string; name: string }[];
  categories: { id: string; name: string; brandId: string }[];
  taxClasses: { id: string; code: string; rateBps: number }[];
}) {
  const [state, formAction, pending] = useActionState(createMenuItem, initialState);
  const [priceRaw, setPriceRaw] = useState<string>("");
  const paise = parseRupeesToPaise(priceRaw);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Select label="Brand" name="brandId" required defaultValue="">
        <option value="" disabled>
          Choose a brand
        </option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>

      <Select label="Category (optional)" name="categoryId" defaultValue="">
        <option value="">No category</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>

      <Input label="Name" name="name" required />
      <Textarea label="Description (optional)" name="description" rows={3} />

      <MoneyInput label="Base price" valuePaise={null} onChangePaise={(_p, raw) => setPriceRaw(raw)} />
      <input type="hidden" name="basePricePaise" value={paise !== null ? paise.toString() : ""} />

      <Select label="Tax class" name="taxClassId" required defaultValue="">
        <option value="" disabled>
          Choose a tax class
        </option>
        {taxClasses.map((t) => (
          <option key={t.id} value={t.id}>
            {t.code} ({(t.rateBps / 100).toFixed(1)}%)
          </option>
        ))}
      </Select>

      <Select label="Diet (optional)" name="diet" defaultValue="">
        <option value="">Not specified</option>
        <option value="veg">Veg</option>
        <option value="non_veg">Non-veg</option>
        <option value="egg">Egg</option>
        <option value="jain">Jain</option>
      </Select>

      {state.error && (
        <p role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Creating…" : "Create item"}
      </Button>
    </form>
  );
}
