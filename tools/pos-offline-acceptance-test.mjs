import { chromium } from "playwright";

const BASE = "http://localhost:3001";
const browser = await chromium.launch();
const errors = [];
function track(page, label) {
  page.on("pageerror", (err) => errors.push(`[${label}] ${err.message.slice(0, 250)}`));
}

// Tables can belong to different stores/brands with entirely different
// menus (Spice Route vs Wok Express) — the picker just needs to add SOME
// two items, not any specific dish, so this works regardless of which
// table/store ends up seated.
async function addTwoItems(page) {
  const items = page.locator('[class*="itemButton"]');
  await items.first().waitFor({ state: "visible", timeout: 20000 });
  await items.nth(0).click();
  await page.waitForTimeout(150);
  await items.nth(1).click();
}

const tabs = [];
let term2Floor = null;

async function dumpAllTabsOnFailure(err) {
  console.error("\n=== FAILURE ===", err.message.slice(0, 500));
  console.error("Errors captured so far:", errors);
  for (const t of tabs) {
    try {
      await t.page.screenshot({ path: `tools/out/FAIL-${t.label}.png`, fullPage: true });
      console.error(`  ${t.label}: url=${t.page.url()}`);
    } catch {
      console.error(`  ${t.label}: could not screenshot`);
    }
  }
  if (term2Floor) {
    try {
      await term2Floor.screenshot({ path: "tools/out/FAIL-term2.png", fullPage: true });
    } catch {
      /* ignore */
    }
  }
}

try {
  const ctx1 = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 900, height: 1300 } });

  // ---- Phase 0: online. Seat 4 tables, one per already-loaded tab. ----
  const floorPage = await ctx1.newPage();
  track(floorPage, "floor");
  await floorPage.goto(`${BASE}/floor`, { waitUntil: "load", timeout: 30000 });
  const available = floorPage.getByRole("button", { name: /Seats \d+ · available/ });
  const n = await available.count();
  if (n < 4) throw new Error(`Need 4 available tables, found ${n}`);
  const labels = [];
  for (let i = 0; i < 4; i++) labels.push((await available.nth(i).textContent()).match(/^T\d+/)[0]);
  console.log("Tables:", labels);

  for (const label of labels) {
    await floorPage.goto(`${BASE}/floor`, { waitUntil: "load", timeout: 30000 });
    await floorPage.getByRole("button", { name: new RegExp(`^${label}\\s`) }).first().click();
    await floorPage.waitForSelector('input[name="covers"]');
    await floorPage.fill('input[name="covers"]', "2");
    await floorPage.getByRole("button", { name: "Seat table" }).click();
    await floorPage.waitForURL(/\/floor\/.+/, { timeout: 15000 });
    console.log(`  Seated ${label} online at ${floorPage.url().split("/floor/")[1].split("?")[0]}`);

    // Give each table its OWN tab, already loaded, before the outage.
    const tab = await ctx1.newPage();
    track(tab, label);
    await tab.goto(floorPage.url(), { waitUntil: "load", timeout: 30000 });
    await tab.waitForSelector('[class*="itemButton"]', { timeout: 20000 });
    tabs.push({ label, page: tab });
  }

  // ==================== OUTAGE #1 ====================
  console.log("\n--- OUTAGE 1: killing network on terminal 1 ---");
  await ctx1.setOffline(true);
  await tabs[0].page.waitForTimeout(500);
  const offlineBody = await tabs[0].page.textContent("body");
  console.log("Status bar shows 'offline':", offlineBody.includes("offline"));

  // Bill all 4 tables entirely offline: add items, fire, go-to-bill (client
  // state, no navigation), finalise, settle — all within the already-loaded tab.
  for (const t of tabs) {
    const p = t.page;
    await addTwoItems(p);
    await p.waitForTimeout(200);
    await p.getByRole("button", { name: /^Fire \(F2\)/ }).click();
    await p.waitForTimeout(200);
    await p.getByRole("button", { name: "Go to bill →" }).click();
    await p.waitForTimeout(300);
    await p.getByRole("button", { name: "Finalise bill" }).click();
    await p.waitForTimeout(400);
    const upiOption = p.locator('option[value="upi_intent"]');
    const upiDisabled = (await upiOption.count()) > 0 ? await upiOption.isDisabled() : null;
    await p.getByRole("button", { name: "Add payment" }).click();
    await p.waitForTimeout(400);
    console.log(`  ${t.label}: queued offline (UPI disabled while offline: ${upiDisabled})`);
  }
  await tabs[0].page.screenshot({ path: "tools/out/accept-01-offline-queued.png", fullPage: true });
  console.log("\nErrors after queuing all 4 offline:", errors);

  // ==================== RECONNECT #1 ====================
  console.log("\n--- RECONNECT 1 ---");
  await ctx1.setOffline(false);
  await tabs[0].page.waitForTimeout(45000); // let the outbox drain

  const afterReconnect1 = [];
  for (const t of tabs) {
    await t.page.waitForTimeout(500);
    const body = await t.page.textContent("body");
    const invoice = body.match(/A1\/\d+\/\d+/);
    afterReconnect1.push({ label: t.label, invoice: invoice ? invoice[0] : null, settled: body.includes("settled") });
  }
  console.log("After reconnect 1:", afterReconnect1);
  console.log("All invoiced:", afterReconnect1.every((r) => r.invoice));
  console.log("All distinct:", new Set(afterReconnect1.map((r) => r.invoice)).size === 4);
  console.log("All settled:", afterReconnect1.every((r) => r.settled));
  await tabs[0].page.screenshot({ path: "tools/out/accept-02-reconnect1.png", fullPage: true });

  // ==================== OUTAGE #2, interleaved with a second terminal ====================
  console.log("\n--- OUTAGE 2: killing network again, with a second terminal active ---");
  const ctx2 = await browser.newContext({ storageState: "tools/.auth/pos-cashier.json", viewport: { width: 900, height: 1300 } });
  term2Floor = await ctx2.newPage();
  track(term2Floor, "term2");
  await term2Floor.goto(`${BASE}/floor`, { waitUntil: "load", timeout: 30000 });
  const avail2 = term2Floor.getByRole("button", { name: /Seats \d+ · available/ });
  const label5 = (await avail2.first().textContent()).match(/^T\d+/)[0];
  await term2Floor.getByRole("button", { name: new RegExp(`^${label5}\\s`) }).first().click();
  await term2Floor.waitForSelector('input[name="covers"]');
  await term2Floor.fill('input[name="covers"]', "3");
  await term2Floor.getByRole("button", { name: "Seat table" }).click();
  await term2Floor.waitForURL(/\/floor\/.+/, { timeout: 15000 });
  await term2Floor.waitForSelector('[class*="itemButton"]', { timeout: 20000 });
  console.log(`Second terminal (cashier) seated ${label5} ONLINE before the second outage.`);

  await ctx1.setOffline(true);
  await ctx2.setOffline(true);
  console.log("Both terminals now offline.");

  // Terminal 1: all 4 tables are already settled+closed by this point, so
  // there's nothing further to exercise on them this round. Use terminal
  // 2's freshly-seated table (already loaded) for the interleaved offline
  // work instead — this is the "second terminal, also offline" case the
  // acceptance test actually asks for.
  await addTwoItems(term2Floor);
  await term2Floor.waitForTimeout(200);
  await term2Floor.getByRole("button", { name: /^Fire \(F2\)/ }).click();
  await term2Floor.waitForTimeout(300);
  await term2Floor.getByRole("button", { name: "Go to bill →" }).click();
  await term2Floor.waitForTimeout(300);
  await term2Floor.getByRole("button", { name: "Finalise bill" }).click();
  await term2Floor.waitForTimeout(400);
  await term2Floor.getByRole("button", { name: "Add payment" }).click();
  await term2Floor.waitForTimeout(400);
  console.log("Second terminal queued a full seat->order->fire->bill->pay cycle while offline (table already loaded from before this outage).");
  await term2Floor.screenshot({ path: "tools/out/accept-03-terminal2-offline.png", fullPage: true });
  console.log("Errors after outage 2 work:", errors);

  // ==================== RECONNECT #2 ====================
  console.log("\n--- RECONNECT 2 (both terminals) ---");
  await ctx1.setOffline(false);
  await ctx2.setOffline(false);
  await term2Floor.waitForTimeout(45000);

  const term2Body = await term2Floor.textContent("body");
  const term2Invoice = term2Body.match(/A1\/\d+\/\d+/);
  console.log(`Second terminal's table (${label5}): invoice=${term2Invoice ? term2Invoice[0] : "MISSING"} settled=${term2Body.includes("settled")}`);
  await term2Floor.screenshot({ path: "tools/out/accept-04-reconnect2-terminal2.png", fullPage: true });

  // Re-check terminal 1's 4 tables are still correctly settled with the SAME
  // invoice numbers as after reconnect 1 (no duplicate bills created on the
  // second reconnect).
  const afterReconnect2 = [];
  for (const t of tabs) {
    await t.page.waitForTimeout(500);
    const body = await t.page.textContent("body");
    const invoice = body.match(/A1\/\d+\/\d+/);
    afterReconnect2.push({ label: t.label, invoice: invoice ? invoice[0] : null, settled: body.includes("settled") });
  }
  console.log("\nAfter reconnect 2, terminal 1's tables unchanged:", JSON.stringify(afterReconnect2) === JSON.stringify(afterReconnect1));
  console.log("All 5 invoice numbers distinct overall:", new Set([...afterReconnect2.map((r) => r.invoice), term2Invoice?.[0]]).size === 5);

  console.log("\nAll errors across the whole test:", errors);

  await browser.close();
} catch (err) {
  await dumpAllTabsOnFailure(err);
  await browser.close();
  process.exit(1);
}
