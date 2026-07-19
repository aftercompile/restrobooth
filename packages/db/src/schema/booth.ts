import { pgTable, uuid, text, timestamp, unique, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { outlets, tables, stores } from "./tenancy.js";
import { tableSessions } from "./operations.js";

export const qrTokens = pgTable(
  "qr_tokens",
  {
    id: uuid("id").primaryKey(),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlets.id),
    tableId: uuid("table_id")
      .notNull()
      .references(() => tables.id),
    tokenHash: text("token_hash").notNull(), // store the HASH, never the token
    rotatesAt: timestamp("rotates_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    unique().on(t.tokenHash),
    // Phase 5: mintTableToken() revokes the old row before minting a
    // replacement (same "rotate, don't reuse" shape as invoice blocks), so
    // this is a belt-and-suspenders DB-level guarantee against ever
    // printing two live QR codes for one table — same pattern as
    // operations.ts's "one_open_day_per_outlet".
    uniqueIndex("one_live_token_per_table")
      .on(t.tableId)
      .where(sql`${t.revokedAt} is null`),
  ],
);

// Anonymous guest session. preferenceVector keys the Booth Host's response
// cache (Phase 6, ADR-0007) — pgvector's Drizzle integration is added when
// that package is actually implemented, not speculatively here.
export const guestSessions = pgTable("guest_sessions", {
  id: uuid("id").primaryKey(),
  tableSessionId: uuid("table_session_id").references(() => tableSessions.id),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id),
  qrTokenId: uuid("qr_token_id")
    .notNull()
    .references(() => qrTokens.id),
  preferences: jsonb("preferences"), // the 3-tap intake
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
