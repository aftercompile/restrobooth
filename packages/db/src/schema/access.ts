import { pgTable, pgSchema, uuid, text, timestamp, unique, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Stub of Supabase's auth schema, for local dev Postgres only (see
// drizzle/0001_bootstrap_local_auth_stub.sql). Against real Supabase this
// schema and table already exist — the FK below only needs `id` to exist
// and be unique, which it is either way.
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id").notNull(), // polymorphic; validated per scope_type by trigger
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.userId, t.scopeType, t.scopeId, t.role),
    index("memberships_user_id_idx").on(t.userId), // the hot path: every RLS check hits this
    check(
      "scope_type_valid",
      sql`${t.scopeType} in ('org','brand','outlet_group','outlet')`,
    ),
    check(
      "role_valid",
      sql`${t.role} in ('org_owner','brand_manager','cluster_manager','outlet_manager','cashier','captain','kitchen')`,
    ),
  ],
);
