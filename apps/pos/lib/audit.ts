import "server-only";
import { schema, type RlsTx } from "@restrobooth/db";

/**
 * Same helper as apps/console/lib/audit.ts, duplicated rather than
 * imported — each app owns its own query/action layer in this repo (same
 * precedent as apps/pos's own copy of getFloor()). TENANCY.md §7.5: "every
 * state transition writes to menu_audit_log," regardless of which app
 * made it — a cashier 86'ing an item from the POS floor is as much a
 * governed transition as an owner doing it from Console.
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
