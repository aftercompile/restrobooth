/**
 * Same mock bridge as apps/pos/lib/printerBridge.ts — see that file's
 * comment for why this is a mock at all (CLAUDE.md rule 8: never invent an
 * API contract). Duplicated rather than shared: each app owns its own
 * server-side layer, same precedent as the auth wiring.
 */
export interface PrinterBridge {
  send(): Promise<"printed" | "queued">;
}

export const mockPrinterBridge: PrinterBridge = {
  async send() {
    return Math.random() < 1 / 6 ? "queued" : "printed";
  },
};
