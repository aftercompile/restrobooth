#!/usr/bin/env node
// Throwaway verification script for Phase 5 Slice 3 (payment + feedback).
// Usage: node tools/booth-pay-test.mjs <mockScanUrl> <cashScanUrl> <upiScanUrl> <posLoginStateFile> <posBaseUrl>
import { chromium } from "playwright";

const [, , mockScanUrl, cashScanUrl, upiScanUrl, posStateFile, posBaseUrl] = process.argv;
if (!mockScanUrl || !cashScanUrl || !upiScanUrl || !posStateFile || !posBaseUrl) {
  console.error("Usage: node tools/booth-pay-test.mjs <mockScanUrl> <cashScanUrl> <upiScanUrl> <posLoginStateFile> <posBaseUrl>");
  process.exit(1);
}

const browser = await chromium.launch();

async function orderAndFire(scanUrl, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(scanUrl, { waitUntil: "networkidle" });
  await page.goto(new URL("/menu", scanUrl).toString(), { waitUntil: "networkidle" });
  const itemButtons = page.locator("button:has-text('₹')");
  await itemButtons.nth(0).click();
  await page.waitForTimeout(500);
  await page.goto(new URL("/", scanUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Place order" }).click();
  await page.waitForTimeout(1000);
  console.log(`[${label}] ordered + fired`);
  return { ctx, page };
}

// --- Mock "pay online" path: full auto-settle + close, then feedback ---
{
  const { page } = await orderAndFire(mockScanUrl, "mock");
  await page.goto(new URL("/", mockScanUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Request bill" }).click();
  await page.waitForURL("**/pay");
  await page.waitForSelector("text=Total payable");
  const billText = await page.locator("body").innerText();
  console.log("[mock] bill panel shows:", billText.split("\n").filter((l) => l.trim()).slice(0, 6).join(" | "));

  await page.getByRole("button", { name: "Pay online" }).click();
  await page.waitForSelector("text=Paid", { timeout: 10000 });
  console.log("[mock] payment result: PAID shown");

  // Feedback (stars are role="radio", not "button" — a radiogroup pattern)
  await page.getByRole("radio", { name: "5 stars" }).click();
  await page.locator("textarea").fill("Great food, quick service!");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await page.waitForSelector("text=Thanks for letting us know", { timeout: 10000 });
  console.log("[mock] feedback submitted and thanked");
}

// --- Cash path: pending claim, staff must confirm ---
let cashSessionLabel = null;
{
  const { page } = await orderAndFire(cashScanUrl, "cash");
  await page.goto(new URL("/", cashScanUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Request bill" }).click();
  await page.waitForURL("**/pay");
  await page.waitForSelector("text=Total payable");
  await page.getByRole("button", { name: "Pay with cash" }).click();
  await page.waitForSelector("text=Please pay your server", { timeout: 10000 });
  console.log("[cash] pending-confirmation message shown");
  cashSessionLabel = "T7"; // matches the table this scanUrl was minted for
}

// --- UPI path: pending claim + a real upi:// deep link ---
{
  const { page } = await orderAndFire(upiScanUrl, "upi");
  await page.goto(new URL("/", upiScanUrl).toString(), { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Request bill" }).click();
  await page.waitForURL("**/pay");
  await page.waitForSelector("text=Total payable");
  await page.getByRole("button", { name: "Pay via UPI app" }).click();
  await page.waitForSelector("text=Open UPI app", { timeout: 10000 });
  const upiHref = await page.locator("a:has-text('Open UPI app')").getAttribute("href");
  console.log("[upi] deep link:", upiHref);
}

// --- Staff side: confirm the cash claim on POS ---
{
  const ctx = await browser.newContext({ storageState: posStateFile });
  const page = await ctx.newPage();
  await page.goto(`${posBaseUrl}/floor`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const bandText = await page.locator("body").innerText();
  console.log("[pos] floor shows 'Payment to confirm':", bandText.includes("Payment to confirm"));

  await page.getByText("Payment to confirm").first().click();
  await page.waitForURL("**/bill");
  await page.waitForSelector("text=Guest claims paid");
  console.log("[pos] bill page shows the pending guest payment");
  await page.getByRole("button", { name: "Confirm" }).first().click();
  await page.waitForTimeout(1500);
  const afterConfirm = await page.locator("body").innerText();
  console.log("[pos] after confirm, shows 'settled':", afterConfirm.toLowerCase().includes("settled"));
}

await browser.close();
console.log("Done.");
