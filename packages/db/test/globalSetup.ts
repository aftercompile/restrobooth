/**
 * Seeds the believable chain exactly once before either suite runs.
 * test/rls and test/override both read/write against the same real
 * Postgres instance; seedBelievableChain() does a TRUNCATE CASCADE, so if
 * each test FILE re-seeded independently, whichever file's beforeAll ran
 * last would wipe out data the other file had already set up (this is
 * exactly what broke the override suite: it ran before the RLS suite's
 * seed and hit a bare FK violation on brand_id). Seeding here, once, and
 * having each suite's own fixtures only ADD to it, removes the ordering
 * dependency entirely.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDbClient } from "../src/client.js";
import { seedBelievableChain } from "../scripts/seed-believable-chain.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export async function setup(): Promise<void> {
  await seedBelievableChain(createDbClient(TEST_DATABASE_URL));
}
