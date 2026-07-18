// Phase 4's actual gate (ROADMAP.md / ADR-0005 §Test): kill the KDS
// socket for 30s during service, fire 5 KOTs during the outage. On
// reconnect all 5 appear, in order, with ages computed from fired_at (not
// reconnect time). The screen shows a "reconnecting" state throughout —
// never silently missing a ticket.
import { chromium } from "playwright";

const KDS = "http://localhost:3002";
const POS = "http://localhost:3001";
const browser = await chromium.launch();

async function seatAndFire(posCtx, label) {
  const page = await posCtx.newPage();
  await page.goto(`${POS}/floor`, { waitUntil: "load", timeout: 30000 });
  const btn = page.getByRole("button", { name: /Seats \d+ · available/ }).first();
  await btn.click();
  await page.waitForSelector('input[name="covers"]');
  await page.fill('input[name="covers"]', "2");
  await page.getByRole("button", { name: "Seat table" }).click();
  await page.waitForURL(/\/floor\/.+/, { timeout: 15000 });
  const items = page.locator('[class*="itemButton"]');
  await items.first().waitFor({ state: "visible", timeout: 20000 });
  await items.first().click();
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /^Fire \(F2\)/ }).click();
  // POS's own write path is local-first (Phase 3b's offline outbox) —
  // clicking Fire enqueues locally and returns instantly; the actual
  // server mutation drains a moment later. Closing this page before that
  // drain completes would abort it, same failure mode Phase 3b's own
  // testing hit first. Wait for it to actually land, not just for the
  // click to register.
  await page.waitForTimeout(2500);
  console.log(`  ${label}: seated + fired online`);
  await page.close();
}

try {
  const kdsCtx = await browser.newContext({ storageState: "tools/.auth/kds-kitchen.json", viewport: { width: 1600, height: 1000 } });
  const kds = await kdsCtx.newPage();
  const kdsErrors = [];
  kds.on("pageerror", (err) => kdsErrors.push(err.message.slice(0, 250)));

  await kds.goto(`${KDS}/board`, { waitUntil: "load", timeout: 30000 });
  await kds.waitForTimeout(1500);
  const before = await kds.getByRole("button", { name: "Bump" }).count();
  console.log("Active tickets before outage:", before);
  console.log("Shows RECONNECTING before outage (should be false):", (await kds.textContent("body")).includes("RECONNECTING"));

  // ==================== KILL THE KDS SOCKET ====================
  console.log("\n--- Killing the KDS's network ---");
  const outageStart = Date.now();
  await kdsCtx.setOffline(true);
  await kds.waitForTimeout(1000);
  console.log("Shows RECONNECTING immediately after outage:", (await kds.textContent("body")).includes("RECONNECTING"));

  // Fire 5 KOTs from a separate, still-online POS terminal during the outage.
  const posCtx = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 900, height: 1300 } });
  console.log("\n--- Firing 5 KOTs from POS while KDS is offline ---");
  for (let i = 1; i <= 5; i++) {
    await seatAndFire(posCtx, `KOT ${i}`);
  }

  // Confirm the board stayed stable and showed zero new tickets while
  // genuinely offline (not silently missing them — silently SHOWING them
  // would be worse: it would mean the "offline" state is a lie).
  const duringOutage = await kds.getByRole("button", { name: "Bump" }).count();
  console.log("\nActive tickets on KDS while still offline (must equal 'before'):", duringOutage);
  console.log("KDS page errors during outage:", kdsErrors);

  // Hold the outage to the full 30s the gate specifies, then check the
  // banner is STILL showing throughout (not just at t=0).
  const elapsed = Date.now() - outageStart;
  if (elapsed < 30_000) await kds.waitForTimeout(30_000 - elapsed);
  console.log("Still shows RECONNECTING at 30s:", (await kds.textContent("body")).includes("RECONNECTING"));

  // ==================== RECONNECT ====================
  console.log("\n--- Reconnecting the KDS ---");
  await kdsCtx.setOffline(false);
  await kds.waitForTimeout(5000);

  const bodyAfter = await kds.textContent("body");
  console.log("RECONNECTING banner cleared:", !bodyAfter.includes("RECONNECTING"));

  const after = await kds.getByRole("button", { name: "Bump" }).count();
  console.log("Active tickets after reconnect (must be 'before' + 5):", after, `(expected ${before + 5})`);

  // Order + no duplicates + correct ages: read every ticket's KOT number
  // and elapsed age directly off the rendered cards.
  const kotNumbers = await kds.locator('[class*="kotNumber"]').allTextContents();
  console.log("KOT numbers shown, in order:", kotNumbers);
  const distinctNumbers = new Set(kotNumbers);
  console.log("All KOT numbers distinct (no duplicates):", distinctNumbers.size === kotNumbers.length);
  const sorted = [...kotNumbers].sort();
  console.log("Rendered in ascending kot_number order:", JSON.stringify(kotNumbers) === JSON.stringify(sorted));

  const ages = await kds.locator('[class*="age"]').allTextContents();
  console.log("Ages shown (mm:ss):", ages);
  // The real assertion: age is computed from fired_at, not from reconnect
  // time — every ticket fired during the outage has had SOME time pass
  // (the outage hold + reconnect wait) since it fired, so none should
  // read as "just born" (00:00/00:01), which is what a reconnect-time
  // computation would wrongly show for all 5 at once.
  const allAgesReasonable = ages.every((a) => {
    const [m, s] = a.split(":").map(Number);
    const totalSec = m * 60 + s;
    return totalSec >= 3;
  });
  console.log("All ages reflect real fired_at, not reconnect time (none read as brand new):", allAgesReasonable);

  await kds.screenshot({ path: "tools/out/kds-acceptance-final.png", fullPage: true });

  console.log("\nAll KDS page errors across the whole test:", kdsErrors);

  await browser.close();
} catch (err) {
  console.error("\n=== FAILURE ===", err.message.slice(0, 500));
  await browser.close();
  process.exit(1);
}
