import Dexie, { type EntityTable } from "dexie";

/**
 * ADR-0004: every mutation writes here FIRST — the UI reads its own
 * pending writes straight out of this table (merged with the server-
 * rendered view), so it is always instant, online or offline. One table
 * is enough: `payload` already carries everything a screen needs to
 * render an optimistic row, so there is no separate "local mirror" of
 * table_sessions/order_items/etc. to keep in sync with this queue.
 *
 * `id` doubles as the idempotency key sent to the server — same value,
 * one meaning, everywhere in the client. UUIDv7 so `createdAt`-order and
 * `id`-sort-order agree (ADR-0004 §2's "causal replay order is
 * recoverable from the key alone").
 */
export type MutationType = "seatTable" | "addOrderItem" | "fireOrder" | "finalizeBill" | "settleBill";
export type OutboxStatus = "pending" | "sending" | "applied" | "rejected";

export interface OutboxEntry {
  id: string;
  mutationType: MutationType;
  payload: Record<string, unknown>;
  createdAt: number;
  /** Denormalized so a session's own pending items can be queried without
   *  reaching into `payload` — null only for seatTable, which doesn't
   *  have a session yet (its own client-generated id IS the session id;
   *  see payload.sessionId there too). */
  sessionId: string | null;
  status: OutboxStatus;
  errorMessage?: string;
  /** Client-computed figures for optimistic display ONLY — never sent to
   *  the server and deliberately kept out of `payload` so it can't affect
   *  the idempotency request-hash (packages/db's withIdempotency hashes
   *  `payload`/`requestBody`, not this). */
  displayHint?: Record<string, unknown>;
}

class OfflineDb extends Dexie {
  outbox!: EntityTable<OutboxEntry, "id">;

  constructor() {
    super("restrobooth-pos-outbox");
    this.version(1).stores({
      outbox: "id, createdAt, sessionId, status, [sessionId+status]",
    });
  }
}

// Lazy singleton: this module is imported from Server Components too (they
// never call any of these functions, but the top-level import must not
// throw during SSR, where `indexedDB` doesn't exist).
let instance: OfflineDb | null = null;

export function getOfflineDb(): OfflineDb {
  if (typeof indexedDB === "undefined") {
    throw new Error("getOfflineDb() called outside the browser");
  }
  instance ??= new OfflineDb();
  return instance;
}
