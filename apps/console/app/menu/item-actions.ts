"use server";

import { eq, schema } from "@restrobooth/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { queryAsCurrentUser } from "../../lib/db";
import { writeAuditLog } from "../../lib/audit";

export type ActionState = { error: string | null };

function requiredString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${key} is required`);
  return value.trim();
}

function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Drizzle wraps every driver-level failure in a DrizzleQueryError whose OWN
 * `.message` is just "Failed query: <sql>" — the actual Postgres error
 * (e.g. our capability trigger's RAISE EXCEPTION text) lives in
 * `.cause.message`. Checking `err.message` alone for a substring like
 * "insufficient privilege" silently never matches; this walks the cause
 * chain and checks all of them.
 */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

/** Rupees-in from MoneyInput's hidden mirror field, paise-out as bigint. Rejects anything that isn't a clean integer of paise (the client already validated the rupee string; this just re-parses server-side, never trusts the client alone for money). */
function requiredPaise(formData: FormData, key: string): bigint {
  const raw = formData.get(key);
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new Error(`${key} must be a whole number of paise`);
  return BigInt(raw);
}

export async function createMenuItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const brandId = requiredString(formData, "brandId");
    const categoryId = optionalString(formData, "categoryId");
    const name = requiredString(formData, "name");
    const description = optionalString(formData, "description");
    const basePricePaise = requiredPaise(formData, "basePricePaise");
    const taxClassId = requiredString(formData, "taxClassId");
    const diet = optionalString(formData, "diet");

    const itemId = crypto.randomUUID();
    await queryAsCurrentUser(async (tx, userId) => {
      if (categoryId) {
        const [category] = await tx.select({ brandId: schema.categories.brandId }).from(schema.categories).where(eq(schema.categories.id, categoryId));
        if (!category || category.brandId !== brandId) throw new Error("Category does not belong to the selected brand");
      }
      await tx.insert(schema.menuItems).values({
        id: itemId, brandId, categoryId, name, description,
        basePricePaise, taxClassId, diet: diet as "veg" | "non_veg" | "egg" | "jain" | null,
        status: "draft",
      });
      await writeAuditLog(tx, { entityType: "menu_item", entityId: itemId, action: "create", actorUserId: userId, toStatus: "draft", newValue: { name, basePricePaise: basePricePaise.toString() } });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not create item" };
  }
  revalidatePath("/menu");
  redirect("/menu");
}

export async function updateMenuItemDetails(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = requiredString(formData, "itemId");
  try {
    const name = requiredString(formData, "name");
    const description = optionalString(formData, "description");
    const basePricePaise = requiredPaise(formData, "basePricePaise");
    const taxClassId = requiredString(formData, "taxClassId");
    const diet = optionalString(formData, "diet");
    const status = requiredString(formData, "status");

    await queryAsCurrentUser(async (tx, userId) => {
      const [before] = await tx.select().from(schema.menuItems).where(eq(schema.menuItems.id, itemId));
      if (!before) throw new Error("Item not found");
      await tx
        .update(schema.menuItems)
        .set({ name, description, basePricePaise, taxClassId, diet: diet as "veg" | "non_veg" | "egg" | "jain" | null, status })
        .where(eq(schema.menuItems.id, itemId));
      await writeAuditLog(tx, {
        entityType: "menu_item", entityId: itemId, action: "update", actorUserId: userId,
        fromStatus: before.status, toStatus: status,
        oldValue: { name: before.name, basePricePaise: before.basePricePaise.toString(), status: before.status },
        newValue: { name, basePricePaise: basePricePaise.toString(), status },
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not update item" };
  }
  revalidatePath(`/menu/${itemId}`);
  return { error: null };
}

/**
 * Sets a store-scoped PRICE override. Capability-gated by the database
 * trigger (drizzle/0012_menu_capability.sql) — a cashier attempting this
 * gets a Postgres exception, which surfaces here as a normal ActionState
 * error rather than a crash. This is deliberately only a friendlier
 * message in FRONT of the trigger, not a replacement for it: the trigger
 * is the actual security boundary.
 */
export async function publishPriceOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = requiredString(formData, "itemId");
  try {
    const storeId = requiredString(formData, "storeId");
    const pricePaise = requiredPaise(formData, "pricePaise");

    await queryAsCurrentUser(async (tx, userId) => {
      const id = crypto.randomUUID();
      await tx.insert(schema.menuItemOverrides).values({
        id, menuItemId: itemId, storeId, pricePaise,
        effectiveFrom: new Date(), status: "published", publishedAt: new Date(),
      });
      await writeAuditLog(tx, {
        entityType: "menu_item_override", entityId: id, action: "publish", actorUserId: userId,
        toStatus: "published", newValue: { storeId, pricePaise: pricePaise.toString() },
      });
    });
  } catch (err) {
    const message = fullErrorMessage(err);
    return {
      error: message.includes("insufficient privilege")
        ? "You don't have permission to change prices. Ask an owner or brand manager."
        : message || "Could not publish price",
    };
  }
  revalidatePath(`/menu/${itemId}`);
  return { error: null };
}

/**
 * 86 (or un-86) an item at a store. Wider access than price — the trigger
 * only guards price_paise, so any staff member with brand/store scope can
 * do this, matching TENANCY.md's "cashier can't change a price, but CAN
 * still 86 an item."
 */
export async function setAvailability(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = requiredString(formData, "itemId");
  try {
    const storeId = requiredString(formData, "storeId");
    const isAvailable = formData.get("isAvailable") === "true";

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
    return { error: fullErrorMessage(err) || "Could not update availability" };
  }
  revalidatePath(`/menu/${itemId}`);
  return { error: null };
}

export async function addOptionGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = requiredString(formData, "itemId");
  try {
    const kind = requiredString(formData, "kind");
    const name = requiredString(formData, "name");
    const minSelect = kind === "variant" ? 1 : Number(formData.get("minSelect") ?? 0);
    const maxSelect = kind === "variant" ? 1 : Number(formData.get("maxSelect") ?? 1);

    await queryAsCurrentUser(async (tx) => {
      await tx.insert(schema.optionGroups).values({
        id: crypto.randomUUID(), menuItemId: itemId, kind, name, minSelect, maxSelect,
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not add option group" };
  }
  revalidatePath(`/menu/${itemId}`);
  return { error: null };
}

export async function addOptionItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const itemId = requiredString(formData, "itemId");
  try {
    const optionGroupId = requiredString(formData, "optionGroupId");
    const name = requiredString(formData, "name");
    const pricePaise = requiredPaise(formData, "pricePaise");

    await queryAsCurrentUser(async (tx) => {
      await tx.insert(schema.optionItems).values({
        id: crypto.randomUUID(), optionGroupId, name, pricePaise,
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not add option" };
  }
  revalidatePath(`/menu/${itemId}`);
  return { error: null };
}
