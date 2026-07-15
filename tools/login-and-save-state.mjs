#!/usr/bin/env node
/**
 * Logs into apps/console via the real form and saves a Playwright
 * storageState JSON so screenshot.mjs can hit authenticated pages without
 * re-logging-in every time.
 *
 * Usage:
 *   node tools/login-and-save-state.mjs <baseUrl> <email> <password> <outState.json>
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const [, , baseUrl, email, password, outState] = process.argv;

if (!baseUrl || !email || !password || !outState) {
  console.error("Usage: node tools/login-and-save-state.mjs <baseUrl> <email> <password> <outState.json>");
  process.exit(1);
}

const outPath = path.resolve(outState);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();

await page.goto(new URL("/login", baseUrl).toString(), { waitUntil: "networkidle" });
await page.fill('input[name="email"], input[type="email"]', email);
await page.fill('input[name="password"], input[type="password"]', password);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 }), page.click('button[type="submit"]')]);
await page.waitForLoadState("networkidle");

await page.context().storageState({ path: outPath });
console.log(`Saved auth state to ${outPath} (final URL: ${page.url()})`);

await browser.close();
