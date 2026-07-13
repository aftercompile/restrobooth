import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

/**
 * The only door through which apps touch Postgres (ADR-0001's escape
 * hatch). Nothing outside this package should import `pg` or
 * `drizzle-orm` directly.
 */
export function createDbClient(connectionString: string) {
  const pool = new Pool({ connectionString });
  return drizzle(pool, { schema });
}

export type Database = ReturnType<typeof createDbClient>;
