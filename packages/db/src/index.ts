export { createDbClient, type Database } from "./client.js";
export { withUser, type RlsTx } from "./rls.js";
export * as schema from "./schema/index.js";

// Re-exported so consumers build query conditions without taking a direct
// dependency on drizzle-orm (ADR-0001's "one door" rule — packages/db is
// the only package that should know it's Drizzle underneath).
export { eq, and, or, desc, asc } from "drizzle-orm";
