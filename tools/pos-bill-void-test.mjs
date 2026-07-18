import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 1440, height: 1400 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 200)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 200)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^T5/ }).first().click();
await page.waitForSelector('input[name="covers"]');
await page.fill('input[name="covers"]', "3");
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

await page.getByRole("button", { name: "Void bill" }).click();
await page.waitForTimeout(1200);
console.log("Errors after void:", errors);
await page.screenshot({ path: "tools/out/pos-bill-voided.png", fullPage: true });

// Confirm session returned to dining: revisit the floor plan and the order pad
await page.goto(sessionUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
console.log("Order pad status text present:", (await page.textContent("body")).includes("dining"));
await page.screenshot({ path: "tools/out/pos-orderpad-after-void.png", fullPage: true });

await browser.close();
