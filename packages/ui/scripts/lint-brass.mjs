#!/usr/bin/env node
// docs/DESIGN.md: "--brass-500 is 2.2:1 on --chalk-50 and FAILS AA for
// text. It is a FILL only... never a text colour." Not Stylelint (no new
// heavy dependency for one rule, matching the Phase 1 plan) — a small,
// direct scan of the CSS this package actually ships.
//
// Rule: a bare `color:` declaration (never `background(-color)`,
// `border(-color)`, `outline(-color)`, `fill`) must not reference
// --brass-500, anywhere, regardless of density context — the simpler,
// stricter reading of "never a text colour" rather than trying to prove
// light-vs-dark context statically from a selector string.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "../src");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".module.css")) out.push(full);
  }
  return out;
}

const COLOR_PROP = /(?<![\w-])color\s*:\s*([^;]+);/g;

let violations = [];
for (const file of walk(srcDir)) {
  const css = readFileSync(file, "utf8");
  for (const match of css.matchAll(COLOR_PROP)) {
    const value = match[1];
    if (value.includes("--brass-500")) {
      const line = css.slice(0, match.index).split("\n").length;
      violations.push(`${path.relative(srcDir, file)}:${line}  color: ${value.trim()};`);
    }
  }
}

if (violations.length > 0) {
  console.error("brass-lint: --brass-500 used as a text `color` (fails AA on chalk-50 — fill only):\n");
  for (const v of violations) console.error("  " + v);
  console.error("\nUse --brass-500 for background/border/outline/fill, never `color`.");
  process.exit(1);
}
console.log("brass-lint: OK — --brass-500 never used as a text color");
