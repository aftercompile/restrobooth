import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 1000, height: 1400 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message.slice(0, 300)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push("[console] " + msg.text().slice(0, 300)); });

await page.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^T4\s.*Seats 6/ }).click();
await page.waitForSelector('input[name="covers"]');
await page.fill('input[name="covers"]', "2");
await page.getByRole("button", { name: "Seat table" }).click();
await page.waitForURL(/\/floor\/.+/, { timeout: 15000 });
console.log("Seated, URL:", page.url());
await page.waitForTimeout(1500);
console.log("Errors after seat:", errors);
await page.screenshot({ path: "tools/out/smoke-01-seated.png", fullPage: true });

await page.getByRole("button", { name: "Butter Chicken ₹400.00" }).click();
await page.waitForTimeout(300);
await page.getByRole("button", { name: "Masala Dosa ₹150.00" }).click();
await page.waitForTimeout(1500);
console.log("Errors after add items:", errors);
await page.screenshot({ path: "tools/out/smoke-02-items.png", fullPage: true });

const bodyAfterAdd = await page.textContent("body");
console.log("Shows Butter Chicken:", bodyAfterAdd.includes("Butter Chicken"));
console.log("Shows Masala Dosa:", bodyAfterAdd.includes("Masala Dosa"));
console.log("Shows total 550.00:", bodyAfterAdd.includes("550.00"));

await page.getByRole("button", { name: /^Fire \(F2\)/ }).click();
await page.waitForTimeout(2000);
console.log("Errors after fire:", errors);
await page.screenshot({ path: "tools/out/smoke-03-fired.png", fullPage: true });

const bodyAfterFire = await page.textContent("body");
console.log("Shows a KOT (queued/printed):", /queued|printed/.test(bodyAfterFire));

await page.getByRole("button", { name: "Go to bill →" }).click();
await page.waitForTimeout(1000);
await page.getByRole("button", { name: "Finalise bill" }).click();
await page.waitForTimeout(2000);
console.log("Errors after finalise:", errors);
await page.screenshot({ path: "tools/out/smoke-04-finalised.png", fullPage: true });

const bodyAfterFinalize = await page.textContent("body");
console.log("Shows invoice A1/:", /A1\/\d+\/\d+/.test(bodyAfterFinalize));

await page.getByRole("button", { name: "Add payment" }).click();
await page.waitForTimeout(2000);
console.log("Errors after settle:", errors);
await page.screenshot({ path: "tools/out/smoke-05-settled.png", fullPage: true });

const bodyAfterSettle = await page.textContent("body");
console.log("Shows settled:", bodyAfterSettle.includes("settled"));

await browser.close();
