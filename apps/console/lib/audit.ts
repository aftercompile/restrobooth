import "server-only";
import { schema, type RlsTx } from "@restrobooth/db";

/**
 * TENANCY.md §7.5: "every state transition writes to menu_audit_log (who,
 * when, from -> to, old value -> new value)." Always called inside the
 * SAME transaction as the mutation it's recording (the tx passed to
 * queryAsCurrentUser's callback) — an audit row that could exist without
 * its mutation, or vice versa, defeats the point of an audit trail.
 */
export async function writeAuditLog(
  tx: RlsTx,
  entry: {
    entityType: "menu_item" | "menu_item_override";
    entityId: string;
    action: string;
    actorUserId: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    oldValue?: unknown;
    newValue?: unknown;
  },
): Promise<void> {
  await tx.insert(schema.menuAuditLog).values({
    id: crypto.randomUUID(),
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    actorUserId: entry.actorUserId,
    fromStatus: entry.fromStatus ?? null,
    toStatus: entry.toStatus ?? null,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
  });
}
