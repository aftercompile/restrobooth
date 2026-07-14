/**
 * One-off verification for the Phase 2 auth checkpoint — NOT part of the
 * permanent test suite. Exercises the exact same two calls the real app
 * makes (supabase-js signInWithPassword, then packages/db's withUser),
 * just without the browser/React layer in between, to prove the wired
 * pipeline actually works: real GoTrue session -> real user id -> RLS
 * actually filtering rows differently per role.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createDbClient } from "../src/client.js";
import { withUser } from "../src/rls.js";
import * as schema from "../src/schema/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") });

const SUPABASE_URL = "http://127.0.0.1:54321";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function checkAs(email: string, password: string) {
  const supabase = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  console.log(`\n${email} -> real GoTrue user id ${data.user.id}`);

  const db = createDbClient(DATABASE_URL);
  const { brands, outlets } = await withUser(db, data.user.id, async (tx) => {
    const brands = await tx.select({ name: schema.brands.name }).from(schema.brands);
    const outlets = await tx.select({ name: schema.outlets.name }).from(schema.outlets);
    return { brands, outlets };
  });
  console.log(`  brands visible:  ${brands.map((b) => b.name).join(", ") || "(none)"}`);
  console.log(`  outlets visible: ${outlets.map((o) => o.name).join(", ") || "(none)"}`);
  return { brands, outlets };
}

async function main() {
  const owner = await checkAs("owner@restrobooth.test", "restrobooth");
  const cashier = await checkAs("cashier@restrobooth.test", "restrobooth");

  console.log("\n--- Verdict ---");
  const ok = owner.brands.length > cashier.brands.length && owner.outlets.length > cashier.outlets.length;
  console.log(
    ok
      ? "PASS: org_owner sees strictly more than the outlet-scoped cashier — RLS is actually filtering by real session identity, not just returning everything."
      : "FAIL: owner and cashier saw the same scope — RLS is not actually discriminating by user.",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
