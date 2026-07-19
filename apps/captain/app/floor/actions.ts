"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { schema, sql } from "@restrobooth/db";
import { queryAsCurrentUser } from "../../lib/db";

export type ActionState = { error: string | null };

/** See the identical, more fully-commented helper in apps/pos's actions —
 *  same fix (drop Drizzle's noisy "Failed query: <sql>" wrapper message). */
function fullErrorMessage(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current instanceof Error) {
    if (!current.message.startsWith("Failed query:")) parts.push(current.message);
    current = current.cause;
  }
  return parts.join(" | ");
}

/** Same seat-a-table logic as apps/pos/app/floor/actions.ts's seatTable. */
export async function seatTable(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const tableId = String(formData.get("tableId") ?? "");
  const outletId = String(formData.get("outletId") ?? "");
  const covers = Number(formData.get("covers") ?? 1);
  // All optional (TENANCY.md-adjacent PII note in DECISIONS.md's guest-details
  // entry) — a walk-in with nothing given is normal, not a validation error.
  const guestName = String(formData.get("guestName") ?? "").trim() || null;
  const guestPhone = String(formData.get("guestPhone") ?? "").trim() || null;
  const guestNotes = String(formData.get("guestNotes") ?? "").trim() || null;

  if (!tableId || !outletId || !Number.isFinite(covers) || covers < 1) {
    return { error: "Missing or invalid seating details." };
  }

  let sessionId: string;
  try {
    sessionId = await queryAsCurrentUser(async (tx) => {
      const claimed = await tx.execute<{ [key: string]: unknown; id: string }>(sql`
        select ts.id from table_sessions ts
        join table_session_tables tst on tst.table_session_id = ts.id
        where tst.table_id = ${tableId}
          and ts.status not in ('closed', 'abandoned', 'merged_into')
        limit 1
      `);
      if (claimed.rows.length > 0) {
        throw new Error(`table already has a live session (${claimed.rows[0]!.id})`);
      }

      const bizday = await tx.execute<{ [key: string]: unknown; id: string }>(sql`
        select id from business_days where outlet_id = ${outletId} and status = 'open' limit 1
      `);
      const businessDayId = bizday.rows[0]?.id;
      if (!businessDayId) throw new Error("no open business day at this outlet — cannot seat a table");

      const stores = await tx.execute<{ [key: string]: unknown; id: string }>(sql`
        select id from stores where outlet_id = ${outletId} and status = 'active'
      `);
      if (stores.rows.length !== 1) {
        throw new Error(`expected exactly one active store at this outlet, found ${stores.rows.length}`);
      }
      const storeId = stores.rows[0]!.id;

      const id = crypto.randomUUID();
      await tx.insert(schema.tableSessions).values({
        id,
        outletId,
        storeId,
        businessDayId,
        status: "open",
        covers,
        idempotencyKey: crypto.randomUUID(),
        guestName,
        guestPhone,
        guestNotes,
      });
      await tx.insert(schema.tableSessionTables).values({ tableSessionId: id, tableId });

      return id;
    });
  } catch (err) {
    return { error: fullErrorMessage(err) || "Could not seat the table." };
  }

  revalidatePath("/floor");
  redirect(`/floor/${sessionId}`);
}
