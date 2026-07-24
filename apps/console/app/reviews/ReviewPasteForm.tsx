"use client";

import { useActionState } from "react";
import { Button, Input, Select, Textarea } from "@restrobooth/ui";
import { submitExternalReview, type ActionState } from "./actions";

const initialState: ActionState = { error: null };

export function ReviewPasteForm({ stores }: { stores: { id: string; outletName: string }[] }) {
  const [state, formAction, pending] = useActionState(submitExternalReview, initialState);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Select label="Store" name="storeId" required defaultValue="">
        <option value="" disabled>
          Choose a store
        </option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.outletName}
          </option>
        ))}
      </Select>

      <Select label="Platform" name="sourcePlatform" required defaultValue="">
        <option value="" disabled>
          Where was this posted?
        </option>
        <option value="zomato">Zomato</option>
        <option value="swiggy">Swiggy</option>
        <option value="google">Google</option>
        <option value="other">Other</option>
      </Select>

      <Textarea label="Review text" name="reviewText" required rows={5} placeholder="Paste the guest's review here, word for word." />

      <Input label="Rating out of 5 (optional)" name="externalRating" type="number" min={1} max={5} />
      <Input label="Author (optional)" name="authorLabel" placeholder="e.g. a first initial and last name, as shown on the platform" />
      <Input label="Date reviewed (optional)" name="reviewedOn" type="date" />

      {state.error && (
        <p role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </p>
      )}

      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Analyzing…" : "Save & analyze"}
      </Button>
    </form>
  );
}
