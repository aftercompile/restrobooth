"use client";

import { useActionState } from "react";
import { Button, Dialog, Input } from "@restrobooth/ui";
import { seatTable, type ActionState } from "./actions";
import type { FloorTable } from "./queries";

const initialState: ActionState = { error: null };

export function SeatTableDialog({ table, onClose }: { table: FloorTable; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(seatTable, initialState);

  return (
    <Dialog open onClose={onClose} title={`Seat ${table.label}`}>
      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <input type="hidden" name="tableId" value={table.tableId} />
        <input type="hidden" name="outletId" value={table.outletId} />
        <Input
          label="Covers"
          name="covers"
          type="number"
          inputMode="numeric"
          min={1}
          max={table.capacity}
          defaultValue={Math.min(2, table.capacity)}
          required
          autoFocus
        />
        {state.error && (
          <p role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)", margin: 0 }}>
            {state.error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Seating…" : "Seat table"}
        </Button>
      </form>
    </Dialog>
  );
}
