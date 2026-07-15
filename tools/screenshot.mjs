#!/usr/bin/env node
/**
 * Self-inspection tool, not a product artifact. Lets the agent actually see
 * rendered pages (screenshot) instead of inferring layout from curl'd HTML.
 *
 * Usage:
 *   node tools/screenshot.mjs <url> <output.png> [options]
 *
 * Options:
 *   --width=N        viewport width (default 1440)
 *   --height=N       viewport height (default 900)
 *   --full-page      capture the full scrollable page, not just the viewport
 *   --wait=MS        extra wait after load, in ms (default 300)
 *   --selector=SEL   wait for this selector before capturing
 *   --state=PATH     load a Playwright storageState JSON (for authenticated pages)
 *   --reduced-motion prefers-reduced-motion: reduce (POS/KDS should look identical either way)
 *   --clip=X,Y,W,H   capture only this pixel region (viewport coords)
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";

const [, , url, out, ...rest] = process.argv;

if (!url || !out) {
  console.error("Usage: node tools/screenshot.mjs <url> <output.png> [options]");
  process.exit(1);
}

const opts = Object.fromEntries(
  rest
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v] = a.slice(2).split("=");
      return [k, v ?? true];
    }),
);

const width = Number(opts.width ?? 1440);
const height = Number(opts.height ?? 900);
const fullPage = Boolean(opts["full-page"]);
const waitMs = Number(opts.wait ?? 300);

const outPath = path.resolve(out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  reducedMotion: opts["reduced-motion"] ? "reduce" : "no-preference",
  storageState: opts.state ? path.resolve(opts.state) : undefined,
});
const page = await context.newPage();

await page.goto(url, { waitUntil: "networkidle" });
if (opts.selector) {
  await page.waitForSelector(String(opts.selector), { timeout: 10_000 });
}
if (waitMs > 0) {
  await page.waitForTimeout(waitMs);
}

const screenshotOpts = { path: outPath, fullPage };
if (opts.clip) {
  const [x, y, width, height] = String(opts.clip).split(",").map(Number);
  screenshotOpts.clip = { x, y, width, height };
  delete screenshotOpts.fullPage;
}
await page.screenshot(screenshotOpts);
console.log(`Saved ${outPath}`);

await browser.close();
