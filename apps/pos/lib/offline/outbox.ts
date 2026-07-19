"use client";

import { getOfflineDb, type MutationType, type OutboxEntry } from "./db";
import { uuid7 } from "./uuid7";
import { applySeatTable } from "../../app/floor/actions";
import { applyAddOrderItem, applyFireOrder } from "../../app/floor/[sessionId]/actions";
import { applyFinalizeBill, applySettleBill } from "../../app/floor/[sessionId]/bill/actions";

/** Enqueues a mutation: writes it to the local outbox and kicks off a
 *  drain attempt. Never awaits the server — the caller already applied
 *  its own optimistic UI update before calling this (ADR-0004: "write to
 *  local store; the UI reads from here; it is always instant"). */
export async function enqueue(
  mutationType: MutationType,
  sessionId: string,
  payload: Record<string, unknown>,
  displayHint?: Record<string, unknown>,
): Promise<string> {
  const db = getOfflineDb();
  const id = uuid7();
  await db.outbox.add({
    id,
    mutationType,
    payload,
    createdAt: Date.now(),
    sessionId,
    status: "pending",
    ...(displayHint !== undefined ? { displayHint } : {}),
  });
  void drainOutbox();
  return id;
}

function isLikelyNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("fetch failed") || msg.includes("load failed");
}

async function applyMutation(entry: OutboxEntry): Promise<unknown> {
  const p = entry.payload;
  switch (entry.mutationType) {
    case "seatTable":
      return applySeatTable(
        entry.id,
        p as { sessionId: string; tableId: string; outletId: string; covers: number; guestName?: string; guestPhone?: string; guestNotes?: string },
      );
    case "addOrderItem":
      return applyAddOrderItem(
        entry.id,
        p as { sessionId: string; orderItemId: string; menuItemId: string; quantity: number; clientLineId: string },
      );
    case "fireOrder":
      return applyFireOrder(entry.id, p as { sessionId: string });
    case "finalizeBill":
      return applyFinalizeBill(
        entry.id,
        p as { sessionId: string; billId: string; discountKind: string; discountValue: string; serviceChargeBps: number },
      );
    case "settleBill":
      return applySettleBill(entry.id, p as { billId: string; sessionId: string; method: string; amountRupees: string });
  }
}

let draining = false;

// IndexedDB is shared across every tab of this origin (ADR-0004 doesn't
// say "one terminal, one tab," and a cashier legitimately might keep a
// tab per table open). Without this lock, two tabs racing `drainOutbox()`
// both read the same "pending" snapshot before either commits a status
// update, both call the server for the SAME entry, and the loser's
// transaction fails on the idempotency_keys unique-key collision — a
// real, observed failure mode (found by the adversarial test), even
// though no data actually duplicates (the DB constraint prevents that
// part). The Web Locks API makes "only one tab drains at a time" a
// property of the browser, not something every caller has to coordinate.
const DRAIN_LOCK_NAME = "restrobooth-pos-outbox-drain";

/**
 * Drains oldest-first (ADR-0004 §2 — UUIDv7 sort order is creation order).
 * A rejected entry (a real server-side refusal: validation, capability,
 * an idempotency-body conflict) blocks only FUTURE entries for its OWN
 * session — a causal dependency only exists within one table's mutation
 * sequence, not across different tables, so table 7's fire shouldn't wait
 * on table 3's rejected item. A network failure stops the whole drain:
 * connectivity is down, nothing behind it will succeed either, and
 * retrying immediately just burns battery/CPU in a loop.
 */
export async function drainOutbox(): Promise<{ applied: number }> {
  if (draining) return { applied: 0 };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { applied: 0 };

  if (typeof navigator !== "undefined" && "locks" in navigator) {
    let result = { applied: 0 };
    await navigator.locks.request(DRAIN_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      // Another tab already holds the lock and is draining the SAME
      // shared queue right now — its writes will reach this tab via
      // Dexie's cross-tab change events (see OfflineStatusBar's
      // `appliedCount` effect), so there's nothing for this call to do.
      if (!lock) return;
      result = await drainOutboxLocked();
    });
    return result;
  }
  // No Web Locks API (very old browser): fall back to the per-tab guard
  // only. Multi-tab races are possible there, but idempotency still
  // prevents actual data duplication — the DB constraint is the backstop
  // either way, this lock is the "keep it from LOOKING broken" layer.
  return drainOutboxLocked();
}

async function drainOutboxLocked(): Promise<{ applied: number }> {
  if (draining) return { applied: 0 };
  draining = true;
  let applied = 0;
  try {
    const db = getOfflineDb();
    const blockedSessions = new Set<string>();
    const pending = await db.outbox.where("status").equals("pending").sortBy("createdAt");

    for (const entry of pending) {
      if (blockedSessions.has(entry.sessionId ?? entry.id)) continue;
      if (typeof navigator !== "undefined" && !navigator.onLine) return { applied };

      await db.outbox.update(entry.id, { status: "sending" });
      try {
        await applyMutation(entry);
        await db.outbox.update(entry.id, { status: "applied" });
        applied++;
      } catch (err) {
        if (isLikelyNetworkError(err)) {
          await db.outbox.update(entry.id, { status: "pending" });
          return { applied }; // connectivity actually down — stop, the caller (online listener / poll) retries later
        }
        const message = err instanceof Error ? err.message : String(err);
        await db.outbox.update(entry.id, { status: "rejected", errorMessage: message });
        blockedSessions.add(entry.sessionId ?? entry.id);
      }
    }
  } finally {
    draining = false;
  }
  return { applied };
}

/** Discards a rejected entry after a human has seen and acted on it —
 *  ADR-0004: "can be skipped explicitly." The outbox row itself, kept
 *  with status 'rejected' until this is called, IS the audit trail; there
 *  is no separate server-side audit row for a skip in this pass. */
export async function discardRejected(outboxId: string): Promise<void> {
  const db = getOfflineDb();
  await db.outbox.delete(outboxId);
}
