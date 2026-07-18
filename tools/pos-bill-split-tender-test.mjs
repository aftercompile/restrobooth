import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 1440, height: 1400 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 200)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 200)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^T6/ }).first().click();
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

await page.getByRole("button", { name: "Finalise bill" }).click();
await page.waitForTimeout(1200);
console.log("Errors after finalise:", errors);

// Payable is 420.00 — pay 200 cash first (partial), then remaining via UPI
const amountInput = page.locator('input[name="amount"]');
await amountInput.fill("200.00");
await page.getByRole("button", { name: "Add payment" }).click();
await page.waitForTimeout(1200);
console.log("Errors after first partial payment:", errors);
await page.screenshot({ path: "tools/out/pos-bill-split-tender-partial.png", fullPage: true });

const bodyAfterFirst = await page.textContent("body");
console.log("Shows remaining 220.00:", bodyAfterFirst.includes("220.00"));

await page.selectOption('select[name="method"]', "upi_intent");
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Add payment" }).click();
await page.waitForTimeout(1200);
console.log("Errors after second payment:", errors);
await page.screenshot({ path: "tools/out/pos-bill-split-tender-settled.png", fullPage: true });

const bodyAfterSecond = await page.textContent("body");
console.log("Shows settled:", bodyAfterSecond.includes("settled"));

await browser.close();
