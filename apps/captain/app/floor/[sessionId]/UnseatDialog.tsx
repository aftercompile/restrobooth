"use client";

import { useActionState } from "react";
import { Button, Dialog, Select } from "@restrobooth/ui";
import { unseatSession, type ActionState } from "./actions";

const UNSEAT_REASONS = [
  { value: "seated_by_mistake", label: "Seated by mistake" },
  { value: "guest_left_before_ordering", label: "Guest left before ordering" },
  { value: "walked_out_unpaid", label: "Walked out without paying" },
  { value: "staff_error", label: "Staff error" },
];

const INITIAL: ActionState = { error: null };

/**
 * Same dialog as apps/pos's UnseatDialog, mirrored here per the owner's
 * explicit request — see that file's comment for the full rationale (a
 * dialog rather than a one-click button since unseating is terminal, no
 * undo once it lands).
 */
export function UnseatDialog({
  sessionId,
  hasActiveItems,
  onClose,
}: {
  sessionId: string;
  hasActiveItems: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(unseatSession, INITIAL);

  return (
    <Dialog open onClose={onClose} title="Unseat table">
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <input type="hidden" name="sessionId" value={sessionId} />
        <p style={{ margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          {hasActiveItems
            ? "This table has fired or served items. Unseating releases the table without billing them — this cannot be undone."
            : "This releases the table back to available. This cannot be undone."}
        </p>
        <Select name="reason" label="Reason" required defaultValue="">
          <option value="" disabled>
            Choose a reason…
          </option>
          {UNSEAT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        {state.error && (
          <p role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)", margin: 0 }}>
            {state.error}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-1)" }}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={pending}>
            {pending ? "Unseating…" : "Unseat table"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
