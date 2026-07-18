import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 900, height: 1400 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 300)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 300)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^T4\s/ }).first().click();
await page.waitForSelector('input[name="covers"]');
await page.fill('input[name="covers"]', "2");
await page.getByRole("button", { name: "Seat table" }).click();
await page.waitForURL(/\/floor\/.+/, { timeout: 15000 });

await page.getByRole("button", { name: "Butter Chicken ₹400.00" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Fire to kitchen|^Fire \(F2\)/ }).click();
await page.waitForTimeout(1200);

await page.getByRole("link", { name: "Go to bill →" }).click();
await page.waitForURL(/\/bill$/, { timeout: 10000 });
await page.waitForTimeout(600);
await page.getByRole("button", { name: "Finalise bill" }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Add payment" }).click();
await page.waitForTimeout(1200);
console.log("Errors through settle:", errors);

// Now issue a partial refund (goodwill, 100 rupees) as the owner (manager).
await page.getByRole("button", { name: "Refund…" }).click();
await page.waitForTimeout(300);
await page.selectOption('select[name="mode"]', "partial");
await page.fill('input[name="amount"]', "100.00");
await page.selectOption('select[name="reasonCode"]', "goodwill_gesture");
await page.fill('input[name="note"]', "Comped a dish - quality issue");
await page.getByRole("button", { name: "Issue credit note" }).click();
await page.waitForTimeout(1200);
console.log("Errors after refund:", errors);
await page.screenshot({ path: "tools/out/pos-refund-result.png", fullPage: true });

const body = await page.textContent("body");
console.log("Shows refunded_partial:", body.includes("refunded_partial"));

const billIdMatch = await page.locator('a[href^="/bill/"]').first().getAttribute("href");
console.log("Invoice link:", billIdMatch);
if (billIdMatch) {
  await page.goto(`http://localhost:3001${billIdMatch}`, { waitUntil: "networkidle" });
  const invBody = await page.textContent("body");
  console.log("Invoice shows credit note section:", invBody.includes("Credit notes"));
  console.log("Invoice shows CN number A1CN:", /A1CN\/\d+\/\d+/.test(invBody));
  console.log("Invoice shows Goodwill gesture:", invBody.includes("Goodwill gesture"));
  console.log("Invoice shows -₹100.00:", invBody.includes("-₹100.00"));
  await page.screenshot({ path: "tools/out/pos-refund-invoice.png", fullPage: true });
}

await browser.close();
