#!/usr/bin/env node
// docs/DESIGN.md: "POS and KDS have ZERO animation. `transition: none` on
// the entire subtree. A 200 ms transition on a billing screen is a bug."
//
// tokens/motion.css enforces that for CSS, but Framer Motion animates from
// JavaScript and ignores `transition: none !important` entirely — so the
// CSS kill-switch is NOT sufficient on its own. src/motion.tsx handles it
// structurally (no motion component is rendered at all on pos/kds), and
// this rule stops anyone bypassing that by importing framer-motion
// directly into a POS or KDS surface.
//
// Same reasoning as lint-brass.mjs: a small direct scan, not a new heavy
// dependency for one rule.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

// The surfaces where motion is banned outright — every app on POS density
// (data-density="pos"), not just the two the rule was first written for.
// apps/captain joined this list in Phase 3a: PRD.md's "dense, touch-first"
// captain app deliberately shares POS's zero-motion density rather than
// getting its own, so the same guard has to cover it.
const BANNED_IN = ["apps/pos", "apps/kds", "apps/captain"];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|jsx?|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const violations = [];
for (const rel of BANNED_IN) {
  const dir = path.join(repoRoot, rel);
  if (!existsSync(dir)) continue; // app not scaffolded yet
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    if (/from\s+["']framer-motion["']|require\(["']framer-motion["']\)/.test(src)) {
      violations.push(path.relative(repoRoot, file));
    }
  }
}

if (violations.length > 0) {
  console.error("motion-lint: framer-motion imported into a ZERO-ANIMATION surface (docs/DESIGN.md):\n");
  for (const v of violations) console.error("  " + v);
  console.error(
    "\nPOS and KDS must have no animation at all — a 200ms transition on a billing\n" +
      "screen is a bug. Use <Animate> from @restrobooth/ui, which renders a plain\n" +
      "element (no motion component) on these densities.",
  );
  process.exit(1);
}
console.log(`motion-lint: OK — no framer-motion in ${BANNED_IN.join(", ")}`);
