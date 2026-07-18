"use server";

import { revalidatePath } from "next/cache";
import { eq, emitOrderStatusEvent, schema, type RlsTx } from "@restrobooth/db";
import { assertKotTransition, type KotStatus } from "@restrobooth/domain";
import { queryAsCurrentUser } from "../../lib/db";

export type ActionState = { error: string | null };
const OK: ActionState = { error: null };

/** See apps/pos's identical, more fully-commented helper — same fix. */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

// DOMAIN.md §3.3's forward path, walked in order. ROADMAP.md's Phase 4
// line and DESIGN.md's own mockup ("[SPACE = bump]") name exactly ONE
// interactive gesture for the forward direction — a cook doesn't click
// through acknowledged/preparing/ready as separate steps; bumping a
// ticket collapses whatever's left of the pipeline into one action. Each
// hop is still a real status write with its own event (see the loop
// below), so the intermediate states remain a genuine, replayable part of
// the audit trail — they're just not separate buttons.
const FORWARD_PATH: readonly KotStatus[] = ["queued", "printed", "acknowledged", "preparing", "ready", "bumped"];

async function loadKot(tx: RlsTx, kotId: string) {
  const kot = (await tx.select().from(schema.kots).where(eq(schema.kots.id, kotId)))[0];
  if (!kot) throw new Error("KOT not found");
  return kot;
}

/**
 * Bump — the one gesture DOMAIN.md/ROADMAP.md actually name. Advances the
 * KOT from wherever it currently sits (queued if the mock print bridge
 * never ACK'd, printed, acknowledged, preparing, or ready) through every
 * remaining legal hop to `bumped`, writing a status update AND an
 * order_status_event per hop — capability-gated by drizzle/0023's
 * can_manage_kot (everyone except brand_manager, TENANCY.md §4).
 */
export async function bumpKot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kotId = String(formData.get("kotId") ?? "");
  if (!kotId) return { error: "Missing KOT." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const kot = await loadKot(tx, kotId);
      const startIndex = FORWARD_PATH.indexOf(kot.status as KotStatus);
      if (startIndex === -1) throw new Error(`KOT is '${kot.status}' — cannot bump from this state`);
      if (kot.status === "bumped") return; // already there — idempotent no-op

      let current = kot.status as KotStatus;
      for (let i = startIndex + 1; i < FORWARD_PATH.length; i++) {
        const next = FORWARD_PATH[i]!;
        assertKotTransition(current, next);
        const patch: { status: KotStatus; bumpedAt?: Date } = { status: next };
        if (next === "bumped") patch.bumpedAt = new Date();
        await tx.update(schema.kots).set(patch).where(eq(schema.kots.id, kotId));
        await emitOrderStatusEvent(tx, {
          outletId: kot.outletId,
          businessDate: kot.businessDate,
          entityType: "kot",
          entityId: kotId,
          eventType: `kot.${next}`,
          payload: { kitchenSection: kot.kitchenSection, kotNumber: kot.kotNumber },
        });
        current = next;
      }
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not bump the ticket." };
  }

  revalidatePath("/board");
  return OK;
}

/**
 * Recall — DOMAIN.md §3.3's sole reverse transition, "audited, because it
 * is also how you'd hide a slow ticket": the order_status_events row this
 * writes (kot.ready, via the same emit call every other transition uses)
 * IS that audit trail — there is no separate mechanism to bypass.
 */
export async function recallKot(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const kotId = String(formData.get("kotId") ?? "");
  if (!kotId) return { error: "Missing KOT." };

  try {
    await queryAsCurrentUser(async (tx) => {
      const kot = await loadKot(tx, kotId);
      assertKotTransition(kot.status as KotStatus, "ready");
      await tx.update(schema.kots).set({ status: "ready", bumpedAt: null }).where(eq(schema.kots.id, kotId));
      await emitOrderStatusEvent(tx, {
        outletId: kot.outletId,
        businessDate: kot.businessDate,
        entityType: "kot",
        entityId: kotId,
        eventType: "kot.recalled",
        payload: { kitchenSection: kot.kitchenSection, kotNumber: kot.kotNumber },
      });
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not recall the ticket." };
  }

  revalidatePath("/board");
  return OK;
}
