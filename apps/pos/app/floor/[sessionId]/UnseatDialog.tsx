"use client";

import { useActionState } from "react";
import { Button, Dialog } from "@restrobooth/ui";
import { unseatSession, type ActionState } from "./actions";

const UNSEAT_REASONS = [
  { value: "seated_by_mistake", label: "Seated by mistake" },
  { value: "guest_left_before_ordering", label: "Guest left before ordering" },
  { value: "walked_out_unpaid", label: "Walked out without paying" },
  { value: "staff_error", label: "Staff error" },
];

const INITIAL: ActionState = { error: null };

/**
 * Releases the table without billing it (`unseatSession`, DOMAIN.md §3.1's
 * `abandoned` status). A dialog rather than a one-click button — same bar
 * as SeatTableDialog for a whole-session action, and this one is terminal
 * (there's no undo once it lands, unlike a pre-fire void).
 */
export function UnseatDialog({
  sessionId,
  hasActiveItems,
  onClose,
}: {
  sessionId: string;
  /** Any fired/served item or KOT on this session — shown as a stronger
   *  warning, since abandoning here writes off kitchen work that already
   *  happened, not just an empty table. */
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
        <label style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "var(--text-sm)", fontWeight: 600 }}>
          Reason
          <select name="reason" required defaultValue="" style={{ font: "inherit", padding: "8px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            <option value="" disabled>
              Choose a reason…
            </option>
            {UNSEAT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
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
