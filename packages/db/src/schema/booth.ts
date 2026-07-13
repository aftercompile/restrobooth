import { pgTable, uuid, text, timestamp, unique, jsonb } from "drizzle-orm/pg-core";
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
  (t) => [unique().on(t.tokenHash)],
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
