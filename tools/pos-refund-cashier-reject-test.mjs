import { chromium } from "playwright";

const browser = await chromium.launch();
// Owner seats+settles a bill, then cashier attempts the refund (should be rejected).
const ownerCtx = await browser.newContext({ storageState: "tools/.auth/pos-owner.json", viewport: { width: 900, height: 1400 } });
const owner = await ownerCtx.newPage();

await owner.goto("http://localhost:3001/floor", { waitUntil: "networkidle" });
await owner.getByRole("button", { name: /^T5\s/ }).first().click();
await owner.waitForSelector('input[name="covers"]');
await owner.fill('input[name="covers"]', "2");
await owner.getByRole("button", { name: "Seat table" }).click();
await owner.waitForURL(/\/floor\/.+/, { timeout: 15000 });
const sessionUrl = owner.url();

await owner.getByRole("button", { name: "Butter Chicken ₹400.00" }).click();
await owner.waitForTimeout(500);
await owner.getByRole("button", { name: /^Fire to kitchen|^Fire \(F2\)/ }).click();
await owner.waitForTimeout(1200);
await owner.getByRole("link", { name: "Go to bill →" }).click();
await owner.waitForURL(/\/bill$/, { timeout: 10000 });
await owner.waitForTimeout(600);
await owner.getByRole("button", { name: "Finalise bill" }).click();
await owner.waitForTimeout(1200);
await owner.getByRole("button", { name: "Add payment" }).click();
await owner.waitForTimeout(1200);

const cashierCtx = await browser.newContext({ storageState: "tools/.auth/pos-cashier.json", viewport: { width: 900, height: 1400 } });
const cashier = await cashierCtx.newPage();
const errors = [];
cashier.on("pageerror", (err) => errors.push(err.message.slice(0, 300)));

await cashier.goto(`${sessionUrl}/bill`, { waitUntil: "networkidle" });
await cashier.getByRole("button", { name: "Refund…" }).click();
await cashier.waitForTimeout(300);
await cashier.selectOption('select[name="reasonCode"]', "goodwill_gesture");
await cashier.getByRole("button", { name: "Issue credit note" }).click();
await cashier.waitForTimeout(1200);

const body = await cashier.textContent("body");
console.log("Rejected with an error message shown:", body.includes("row-level security") || body.includes("privilege") || body.includes("Could not issue"));
console.log("Page errors:", errors);
await cashier.screenshot({ path: "tools/out/pos-refund-cashier-rejected.png", fullPage: true });

await browser.close();
