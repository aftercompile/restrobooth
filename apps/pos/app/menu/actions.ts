"use server";

import { schema } from "@restrobooth/db";
import { revalidatePath } from "next/cache";
import { queryAsCurrentUser } from "../../lib/db";
import { writeAuditLog } from "../../lib/audit";

export type ActionState = { error: string | null };

/**
 * Same mutation as apps/console/app/menu/item-actions.ts's setAvailability
 * — an insert into menu_item_overrides is all an 86/un-86 ever is (TENANCY.md
 * §7: sparse override rows, never a destructive edit of the base item).
 * Only price_paise is capability-guarded by the DB trigger
 * (drizzle/0012_menu_capability.sql); availability is deliberately open to
 * any staff member with store scope, which is what makes this a POS action
 * and not a Console-only one — TENANCY.md: "a cashier can't change a
 * price, but CAN still 86 an item."
 */
export async function setAvailability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = String(formData.get("itemId") ?? "");
  const storeId = String(formData.get("storeId") ?? "");
  if (!itemId || !storeId) return { error: "Missing item or store" };
  const isAvailable = formData.get("isAvailable") === "true";

  try {
    await queryAsCurrentUser(async (tx, userId) => {
      const id = crypto.randomUUID();
      await tx.insert(schema.menuItemOverrides).values({
        id, menuItemId: itemId, storeId, isAvailable,
        effectiveFrom: new Date(), status: "published", publishedAt: new Date(),
      });
      await writeAuditLog(tx, {
        entityType: "menu_item_override", entityId: id, action: "set_availability", actorUserId: userId,
        toStatus: "published", newValue: { storeId, isAvailable },
      });
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not update availability" };
  }
  revalidatePath("/menu");
  return { error: null };
}
