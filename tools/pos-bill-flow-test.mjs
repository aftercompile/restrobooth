import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 1440, height: 1400 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 200)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 200)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
// Seat a fresh table (T4, unlikely used by prior tests)
await page.getByRole("button", { name: /^T4/ }).first().click();
await page.waitForSelector('input[name="covers"]');
await page.fill('input[name="covers"]', "2");
await page.getByRole("button", { name: "Seat table" }).click();
await page.waitForURL(/\/floor\/.+/, { timeout: 15000 });
const sessionUrl = page.url();
console.log("Seated at:", sessionUrl);

await page.getByRole("button", { name: "Butter Chicken ₹400.00" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Fire to kitchen|^Fire \(F2\)/ }).click();
await page.waitForTimeout(1200);

await page.getByRole("link", { name: "Go to bill →" }).click();
await page.waitForURL(/\/bill$/, { timeout: 10000 });
await page.waitForTimeout(800);
console.log("Errors after reaching bill page:", errors);
await page.screenshot({ path: "tools/out/pos-bill-preview.png", fullPage: true });

// Finalise
await page.getByRole("button", { name: "Finalise bill" }).click();
await page.waitForTimeout(1200);
console.log("Errors after finalise:", errors);
await page.screenshot({ path: "tools/out/pos-bill-finalised.png", fullPage: true });

// Settle (pay in full via the pre-filled amount)
const addPaymentBtn = page.getByRole("button", { name: "Add payment" });
if (await addPaymentBtn.count() > 0) {
  await addPaymentBtn.click();
  await page.waitForTimeout(1200);
}
console.log("Errors after settle:", errors);
await page.screenshot({ path: "tools/out/pos-bill-settled.png", fullPage: true });

await browser.close();
