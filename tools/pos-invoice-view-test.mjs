import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 900, height: 1400 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 300)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 300)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^T7/ }).first().click();
await page.waitForSelector('input[name="covers"]');
await page.fill('input[name="covers"]', "4");
await page.getByRole("button", { name: "Seat table" }).click();
await page.waitForURL(/\/floor\/.+/, { timeout: 15000 });

await page.getByRole("button", { name: "Butter Chicken ₹400.00" }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: "Masala Dosa ₹150.00" }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Fire to kitchen|^Fire \(F2\)/ }).click();
await page.waitForTimeout(1200);

await page.getByRole("link", { name: "Go to bill →" }).click();
await page.waitForURL(/\/bill$/, { timeout: 10000 });
await page.waitForTimeout(800);
await page.getByRole("button", { name: "Finalise bill" }).click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "Add payment" }).click();
await page.waitForTimeout(1200);
console.log("Errors through settle:", errors);

const invoiceLink = page.getByRole("link", { name: "View / print invoice" });
await invoiceLink.click();
await page.waitForURL(/\/bill\/[0-9a-f-]+$/, { timeout: 10000 });
await page.waitForTimeout(800);
console.log("Errors on invoice page:", errors);
await page.screenshot({ path: "tools/out/pos-invoice-view.png", fullPage: true });

const body = await page.textContent("body");
console.log("Has invoice no A1/:", /A1\/\d+\/\d+/.test(body));
console.log("Has Butter Chicken:", body.includes("Butter Chicken"));
console.log("Has Masala Dosa:", body.includes("Masala Dosa"));
console.log("Has CGST:", body.includes("CGST"));
console.log("Has Payable:", body.includes("Payable"));

await browser.close();
