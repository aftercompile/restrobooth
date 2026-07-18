import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 900, height: 1600 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 300)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 300)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^T3\s/ }).first().click();
await page.waitForSelector('input[name="covers"]');
await page.fill('input[name="covers"]', "2");
await page.getByRole("button", { name: "Seat table" }).click();
await page.waitForURL(/\/floor\/.+/, { timeout: 15000 });

// Guest 1: Butter Chicken (own). Guest 2: Masala Dosa (own). Shared: Garlic Naan (both).
await page.getByRole("button", { name: "Butter Chicken ₹400.00" }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Masala Dosa ₹150.00" }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Garlic Naan ₹55.00" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Fire to kitchen|^Fire \(F2\)/ }).click();
await page.waitForTimeout(1200);

await page.getByRole("link", { name: "Go to bill →" }).click();
await page.waitForURL(/\/bill$/, { timeout: 10000 });
await page.waitForTimeout(600);

await page.getByRole("button", { name: "Split by item/guest" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: "tools/out/pos-split-items-form.png", fullPage: true });

// Every item defaults to Guest 1. Move Masala Dosa to Guest 2 only.
// Uncheck G1 for Masala Dosa's row, check G2.
const rows = page.locator("table tbody tr");
const rowCount = await rows.count();
console.log("Item rows:", rowCount);

// Find the Masala Dosa row and toggle its checkboxes: uncheck G1, check G2.
for (let i = 0; i < rowCount; i++) {
  const rowText = await rows.nth(i).textContent();
  if (rowText.includes("Masala Dosa")) {
    const checkboxes = rows.nth(i).locator('input[type="checkbox"]');
    await checkboxes.nth(0).uncheck(); // G1
    await checkboxes.nth(1).check(); // G2
  }
  if (rowText.includes("Garlic Naan")) {
    const checkboxes = rows.nth(i).locator('input[type="checkbox"]');
    await checkboxes.nth(1).check(); // also G2 -> shared between G1 and G2
  }
}
await page.screenshot({ path: "tools/out/pos-split-items-assigned.png", fullPage: true });

await page.getByRole("button", { name: "Split into checks" }).click();
await page.waitForTimeout(1200);
console.log("Errors after split:", errors);
await page.screenshot({ path: "tools/out/pos-split-items-result.png", fullPage: true });

const body = await page.textContent("body");
const invoiceMatches = body.match(/A1\/\d+\/\d+/g) ?? [];
console.log("Distinct invoice numbers:", new Set(invoiceMatches).size, invoiceMatches);

const billIds = await page.locator('input[name="billId"]').evaluateAll((els) => [...new Set(els.map((e) => e.value))]);
console.log("Bill IDs:", billIds);

// Settle every bill fully, then inspect each real invoice page.
for (let i = 0; i < billIds.length; i++) {
  await page.getByRole("button", { name: "Add payment" }).first().click();
  await page.waitForTimeout(900);
}
console.log("Errors after settling all:", errors);

for (const billId of billIds) {
  await page.goto(`http://localhost:3001/bill/${billId}`, { waitUntil: "networkidle" });
  const invBody = await page.textContent("body");
  console.log(`--- invoice ${billId} ---`);
  console.log("  Butter Chicken:", invBody.includes("Butter Chicken"), "| Masala Dosa:", invBody.includes("Masala Dosa"), "| shared:", invBody.includes("shared"));
}
await page.screenshot({ path: "tools/out/pos-split-items-last-invoice.png", fullPage: true });

await browser.close();
