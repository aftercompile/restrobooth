"use server";

import { revalidatePath } from "next/cache";
import { eq, schema, sql } from "@restrobooth/db";
import { queryAsCurrentUser } from "../../lib/db";
import { getCloseChecklist, getExpectedCash } from "./queries";

export type ActionState = { error: string | null };
const OK: ActionState = { error: null };

/** See apps/pos's other actions.ts files — same fix (drop Drizzle's noisy
 *  "Failed query: <sql>" wrapper message before showing a user the reason). */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

/**
 * DOMAIN.md §4: opens today's (IST) business day and, since a day-open
 * also opens its one terminal's drawer (single-terminal-per-outlet
 * assumption), the terminal_day_drawers row with the supplied opening
 * float. The partial unique index `one_open_day_per_outlet` is the actual
 * enforcement that only one day can be open at a time — this just
 * surfaces a friendly error if it fires.
 */
export async function openDay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const outletId = String(formData.get("outletId") ?? "");
  const openingFloatRupees = String(formData.get("openingFloat") ?? "0");
  if (!outletId) return { error: "Missing outlet." };

  const openingFloatPaise = BigInt(Math.round(Number(openingFloatRupees) * 100));
  if (!Number.isFinite(Number(openingFloatRupees)) || openingFloatPaise < 0n) {
    return { error: "Opening float must be a non-negative amount." };
  }

  try {
    await queryAsCurrentUser(async (tx, userId) => {
      const terminal = (await tx.select().from(schema.terminals).where(eq(schema.terminals.outletId, outletId)))[0];
      if (!terminal) throw new Error("no terminal found for this outlet");

      const businessDate = await tx.execute<{ [key: string]: unknown; today: string }>(
        sql`select (now() at time zone 'Asia/Kolkata')::date::text as today`,
      );
      const today = businessDate.rows[0]!.today;

      const dayId = crypto.randomUUID();
      await tx.insert(schema.businessDays).values({
        id: dayId,
        outletId,
        businessDate: today,
        status: "open",
        openedBy: userId,
        openedAt: new Date(),
      });

      await tx.insert(schema.terminalDayDrawers).values({
        id: crypto.randomUUID(),
        businessDayId: dayId,
        terminalId: terminal.id,
        outletId,
        openingFloatPaise,
        openedBy: userId,
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not open the day." };
  }

  revalidatePath("/day");
  return OK;
}

/**
 * DOMAIN.md §4.4's checklist, enforced server-side (not just a UI
 * pre-check the client could bypass): every session closed/merged/
 * abandoned, every KOT bumped/voided, every bill settled/voided/
 * discarded, THEN the drawer is counted and the day closes. All in one
 * transaction — a day that closes with only some of the checklist true is
 * exactly the bug this exists to prevent.
 */
export async function closeDay(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const businessDayId = String(formData.get("businessDayId") ?? "");
  const outletId = String(formData.get("outletId") ?? "");
  const terminalId = String(formData.get("terminalId") ?? "");
  const drawerId = String(formData.get("drawerId") ?? "");
  const countedRupees = String(formData.get("countedCash") ?? "");
  const varianceNote = String(formData.get("varianceNote") ?? "").trim() || null;

  if (!businessDayId || !outletId || !terminalId || !drawerId) return { error: "Missing day/terminal/drawer." };

  const countedPaise = BigInt(Math.round(Number(countedRupees) * 100));
  if (!Number.isFinite(Number(countedRupees)) || countedPaise < 0n) {
    return { error: "Counted cash must be a non-negative amount." };
  }

  try {
    await queryAsCurrentUser(async (tx, userId) => {
      const checklist = await getCloseChecklist(tx, outletId, businessDayId);
      if (checklist.openTableSessions > 0) {
        throw new Error(`${checklist.openTableSessions} table session(s) are still open, merged in, or unresolved`);
      }
      if (checklist.unresolvedKots > 0) {
        throw new Error(`${checklist.unresolvedKots} KOT(s) are not yet bumped or voided`);
      }
      if (checklist.unsettledBills > 0) {
        throw new Error(`${checklist.unsettledBills} bill(s) are not yet settled, voided, or discarded`);
      }

      const drawer = (await tx.select().from(schema.terminalDayDrawers).where(eq(schema.terminalDayDrawers.id, drawerId)))[0];
      if (!drawer) throw new Error("drawer not found");

      const expectedPaise = await getExpectedCash(tx, businessDayId, terminalId, drawer.openingFloatPaise);
      const variancePaise = countedPaise - expectedPaise;
      if (variancePaise !== 0n && !varianceNote) {
        throw new Error(`a non-zero variance (${variancePaise} paise) requires a note`);
      }

      await tx
        .update(schema.terminalDayDrawers)
        .set({ countedPaise, variancePaise, varianceNote, countedBy: userId, countedAt: new Date() })
        .where(eq(schema.terminalDayDrawers.id, drawerId));

      await tx
        .update(schema.businessDays)
        .set({ status: "closed", closedBy: userId, closedAt: new Date() })
        .where(eq(schema.businessDays.id, businessDayId));
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not close the day." };
  }

  revalidatePath("/day");
  return OK;
}
