"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Input } from "@restrobooth/ui";
import { enqueue } from "../../lib/offline/outbox";
import { uuid7 } from "../../lib/offline/uuid7";
import type { FloorTable } from "./queries";

/**
 * ADR-0004: seating a table is one of the offline-critical mutations.
 * The session id is generated HERE, not by the server, so navigation to
 * `/floor/{sessionId}` can happen immediately — online or off — with no
 * round trip in between. `enqueue()` writes the mutation to the local
 * outbox and kicks off a drain attempt; it does not wait for the server.
 */
export function SeatTableDialog({ table, onClose }: { table: FloorTable; onClose: () => void }) {
  const router = useRouter();
  const [covers, setCovers] = useState(Math.min(2, table.capacity));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(covers) || covers < 1) {
      setError("Covers must be at least 1.");
      return;
    }
    setPending(true);
    const sessionId = uuid7();
    try {
      await enqueue("seatTable", sessionId, { sessionId, tableId: table.tableId, outletId: table.outletId, covers });
    } catch (err) {
      setPending(false);
      setError(err instanceof Error ? err.message : "Could not seat the table.");
      return;
    }
    router.push(`/floor/${sessionId}?outletId=${table.outletId}&tableId=${table.tableId}&covers=${covers}`);
  }

  return (
    <Dialog open onClose={onClose} title={`Seat ${table.label}`}>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        <Input
          label="Covers"
          name="covers"
          type="number"
          inputMode="numeric"
          min={1}
          max={table.capacity}
          value={covers}
          onChange={(e) => setCovers(Number(e.target.value))}
          required
          autoFocus
        />
        {error && (
          <p role="alert" style={{ color: "var(--signal-600)", fontSize: "var(--text-sm)", margin: 0 }}>
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Seating…" : "Seat table"}
        </Button>
      </form>
    </Dialog>
  );
}
