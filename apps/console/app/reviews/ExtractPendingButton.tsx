"use client";

import { useActionState } from "react";
import { Button } from "@restrobooth/ui";
import { extractPendingFeedback, type ActionState } from "./actions";

const initialState: ActionState = { error: null };

export function ExtractPendingButton() {
  const [state, formAction, pending] = useActionState(async (_prev: ActionState) => extractPendingFeedback(), initialState);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? "Analyzing…" : "Analyze now"}
      </Button>
      {state.error && (
        <span role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
