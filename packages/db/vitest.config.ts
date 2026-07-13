import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Schema, RLS suite (test/rls/), override suite (test/override/), and
    // partitioning tests land in the next Phase 1 checkpoint.
    passWithNoTests: true,
  },
});
