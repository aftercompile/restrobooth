import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 900, height: 1600 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 300)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 300)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^T1\s/ }).first().click();
await page.waitForSelector('input[name="covers"]');
await page.fill('input[name="covers"]', "3");
await page.getByRole("button", { name: "Seat table" }).click();
await page.waitForURL(/\/floor\/.+/, { timeout: 15000 });

await page.getByRole("button", { name: "Butter Chicken ₹400.00" }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Masala Dosa ₹150.00" }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Chicken 65 ₹300.00" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Fire to kitchen|^Fire \(F2\)/ }).click();
await page.waitForTimeout(1200);

await page.getByRole("link", { name: "Go to bill →" }).click();
await page.waitForURL(/\/bill$/, { timeout: 10000 });
await page.waitForTimeout(600);

await page.getByRole("button", { name: "Split by amount" }).click();
await page.waitForTimeout(300);
await page.fill('input[name="ways"]', "3");
await page.getByRole("button", { name: "Split evenly" }).click();
await page.waitForTimeout(1200);
console.log("Errors after split:", errors);
await page.screenshot({ path: "tools/out/pos-split-amount-result.png", fullPage: true });

const body1 = await page.textContent("body");
const invoiceMatches = body1.match(/A1\/\d+\/\d+/g) ?? [];
console.log("Distinct invoice numbers found:", new Set(invoiceMatches).size, invoiceMatches);

// Settle both bills fully
const addPaymentButtons = page.getByRole("button", { name: "Add payment" });
const count = await addPaymentButtons.count();
console.log("Add payment buttons found:", count);
for (let i = 0; i < count; i++) {
  await page.getByRole("button", { name: "Add payment" }).first().click();
  await page.waitForTimeout(1000);
}
console.log("Errors after settling both:", errors);
await page.screenshot({ path: "tools/out/pos-split-amount-settled.png", fullPage: true });

const body2 = await page.textContent("body");
console.log("Both show settled:", (body2.match(/settled/g) ?? []).length >= 2);

await browser.close();
