/**
 * No real thermal printer integration exists (CLAUDE.md rule 8: never
 * invent an API contract). This is the mock, coded to the interface a real
 * bridge would implement, so swapping one in later is a new
 * implementation of `PrinterBridge`, not a rewrite of every call site.
 *
 * ROADMAP.md's own acceptance line for this phase: "buy a real thermal
 * printer — do not discover the code-page problem during a pilot." That's
 * a hardware purchase, not something this mock can stand in for; it only
 * proves the ACK/timeout *contract* the POS depends on.
 */
export interface PrinterBridge {
  /** Attempts to print. Resolves "printed" on a real ACK, "queued" if the
   *  bridge never acknowledged (the POS's own 10s-no-ACK alarm is what
   *  surfaces this to a human — DOMAIN.md §3.3). */
  send(): Promise<"printed" | "queued">;
}

/**
 * Simulates a real bridge's failure mode instead of always succeeding —
 * an always-green mock would never exercise the alarm path DOMAIN.md §3.3
 * exists for ("a KOT with no ACK after 10s is the worst bug in the
 * system"). ~1 in 6 tickets "jams": the row is left in 'queued' for the
 * POS's own client-side timer to catch.
 */
export const mockPrinterBridge: PrinterBridge = {
  async send() {
    return Math.random() < 1 / 6 ? "queued" : "printed";
  },
};
