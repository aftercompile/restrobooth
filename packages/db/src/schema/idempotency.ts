import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { outlets } from "./tenancy.js";

// Underwrites offline sync, aggregator webhooks, and payment callbacks alike
// (DOMAIN.md §8, ADR-0004). Same key + same body hash -> return the stored
// response. Same key + different hash -> 409 (a client bug, made loud).
export const idempotencyKeys = pgTable("idempotency_keys", {
  key: uuid("key").primaryKey(),
  outletId: uuid("outlet_id")
    .notNull()
    .references(() => outlets.id),
  endpoint: text("endpoint").notNull(),
  requestHash: text("request_hash").notNull(),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
