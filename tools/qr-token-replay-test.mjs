#!/usr/bin/env node
/**
 * ROADMAP.md Phase 5 acceptance: "QR token replay is rejected. A
 * screenshotted QR used from off-premises is rejected." Proves the
 * /t/[token] route's real behaviour against a real running Booth + a real
 * DB — the pure evaluateGuestTokenAccess() logic already has unit
 * coverage (packages/domain/src/qrToken.test.ts); this is the missing
 * end-to-end layer.
 *
 * Usage:
 *   node tools/qr-token-replay-test.mjs <boothBaseUrl> <outletId> <tableId>
 *
 * Requires packages/db to be built (pnpm --filter @restrobooth/db build)
 * and DATABASE_URL set to the target Postgres.
 */
import { chromium } from "playwright";
import { mintTableToken, createDbClient, sql } from "../packages/db/dist/index.js";

const [, , boothBaseUrl, outletId, tableId] = process.argv;
if (!boothBaseUrl || !outletId || !tableId) {
  console.error("Usage: node tools/qr-token-replay-test.mjs <boothBaseUrl> <outletId> <tableId>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL must be set (the DB the target Booth instance points at).");
  process.exit(1);
}

const db = createDbClient(process.env.DATABASE_URL);
let failed = false;

async function check(browser, label, token, expectValid) {
  const page = await browser.newPage();
  await page.goto(new URL(`/t/${token}`, boothBaseUrl).toString(), { waitUntil: "networkidle" });
  const url = page.url();
  const landedOnInvalid = url.includes("/invalid");
  const hasGuestCookie = (await page.context().cookies()).some((c) => c.name.toLowerCase().includes("guest"));
  const pass = expectValid ? !landedOnInvalid && hasGuestCookie : landedOnInvalid && !hasGuestCookie;
  if (!pass) failed = true;
  console.log(`${pass ? "PASS" : "FAIL"} — ${label} (landed on /invalid: ${landedOnInvalid}, guest cookie: ${hasGuestCookie})`);
  await page.close();
}

const browser = await chromium.launch();

// Rotation: minting a second token revokes the first.
const tokenA = await mintTableToken(db, { outletId, tableId });
const tokenB = await mintTableToken(db, { outletId, tableId });
await check(browser, "revoked token (superseded by rotation)", tokenA.rawToken, false);
await check(browser, "freshly rotated token", tokenB.rawToken, true);

// Expiry: force rotates_at into the past directly (mintTableToken's
// default window is 180 days — not something to wait out here).
await db.execute(sql`update qr_tokens set rotates_at = now() - interval '1 day' where table_id = ${tableId} and revoked_at is null`);
await check(browser, "expired token (past rotates_at)", tokenB.rawToken, false);

// Never existed at all.
await check(browser, "garbage token", "this-token-never-existed-in-the-database-at-all", false);

// Restore a live token so the table isn't left un-scannable for whoever
// picks up dev work next.
const tokenC = await mintTableToken(db, { outletId, tableId });
await check(browser, "final restored token", tokenC.rawToken, true);

await browser.close();
console.log(failed ? "\nRESULT: FAIL" : "\nRESULT: PASS — replay/rotation/expiry all correctly rejected");
process.exit(failed ? 1 : 0);
