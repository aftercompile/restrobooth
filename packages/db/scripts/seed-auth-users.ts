/**
 * Bridges the believable-chain seed (which inserts auth.users STUB rows
 * with fixed fixture ids, for RLS testing) to REAL, login-able Supabase
 * Auth accounts.
 *
 * The believable-chain seed's memberships reference fixture user ids like
 * USER_ORG1_OWNER. GoTrue, though, generates its own uuid when it creates
 * a user (the admin API can't be told to use a specific id), so this
 * script creates the GoTrue account, then REPOINTS the matching
 * memberships at the real generated id. Idempotent: re-running finds the
 * existing account by email and repoints again — which is exactly what you
 * do after re-running `pnpm seed` (that truncates memberships back to
 * fixture ids).
 *
 * Only the handful of accounts needed to demo Phase 2's capability rule are
 * created: an owner who can publish prices, and a cashier who cannot.
 *
 * Usage: pnpm --filter @restrobooth/db seed:auth   (after `pnpm seed`)
 * Requires the Supabase CLI local stack running (real GoTrue on :54321).
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import * as id from "./data/fixture-ids.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
// The Supabase CLI local stack's well-known demo service-role key — the
// SAME for every `supabase start`, not a secret. A real deploy supplies
// its own via env.
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DATABASE_URL =
  process.env.SEED_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PASSWORD = "restrobooth"; // dev-only; every seeded account shares it

const ACCOUNTS = [
  { fixtureId: id.USER_ORG1_OWNER, email: "owner@restrobooth.test", label: "org_owner (can publish prices)" },
  { fixtureId: id.USER_AMD_CASHIER, email: "cashier@restrobooth.test", label: "cashier (cannot publish prices)" },
  { fixtureId: id.USER_AMD_KITCHEN, email: "kitchen@restrobooth.test", label: "kitchen (Phase 4 KDS login)" },
];

async function main() {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();

  // One page of users is plenty at seed scale — used to find an existing
  // account on an idempotent re-run.
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  for (const account of ACCOUNTS) {
    let userId: string;
    const found = existing?.users.find((u) => u.email === account.email);
    if (found) {
      userId = found.id;
      console.log(`  ${account.email}: already exists (${userId})`);
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser ${account.email}: ${error?.message}`);
      userId = data.user.id;
      console.log(`  ${account.email}: created (${userId})`);
    }

    // Repoint every membership from the fixture stub id to the real GoTrue
    // id. The GoTrue user row already exists in auth.users, so the FK holds.
    const res = await db.query("update memberships set user_id = $1 where user_id = $2", [
      userId,
      account.fixtureId,
    ]);
    console.log(`    repointed ${res.rowCount} membership row(s) — ${account.label}`);
  }

  await db.end();
  console.log("\nDone. Log in at /login with any of the above emails, password:", PASSWORD);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
