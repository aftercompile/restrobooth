import * as schema from "./schema/index.js";
import { sql } from "drizzle-orm";
import type { RlsTx } from "./rls.js";

// Matches order_status_events' entity_type_valid CHECK (0000_init_schema.sql).
export type OrderStatusEntityType = "order" | "order_item" | "kot" | "table_session" | "bill";

export interface EmitOrderStatusEventParams {
  outletId: string;
  businessDate: string;
  entityType: OrderStatusEntityType;
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

/**
 * ADR-0005 §1: the sequence-numbered event log a KDS reconnects against.
 * MUST run inside the same transaction as the state change it describes —
 * that atomicity (drawn from `next_outlet_event_seq`, a row-locked
 * per-outlet counter, then inserted in the same `tx`) is what makes "the
 * KOT changed" and "there is a durable, gap-detectable record of it"
 * commit or roll back together. There is no code path that changes a
 * kot's status without also calling this.
 */
export async function emitOrderStatusEvent(tx: RlsTx, params: EmitOrderStatusEventParams): Promise<bigint> {
  const seqResult = await tx.execute<{ [key: string]: unknown; seq: string }>(sql`
    select next_outlet_event_seq(${params.outletId}) as seq
  `);
  const seq = BigInt(seqResult.rows[0]!.seq);

  await tx.insert(schema.orderStatusEvents).values({
    id: crypto.randomUUID(),
    businessDate: params.businessDate,
    outletId: params.outletId,
    eventSeq: seq,
    entityType: params.entityType,
    entityId: params.entityId,
    eventType: params.eventType,
    payload: params.payload ?? {},
  });

  return seq;
}
