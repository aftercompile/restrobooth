import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Phase 1 shipped this package as an empty, correctly-wired shell.
    // No longer empty as of Phase 3b — kept true anyway so a package with
    // genuinely zero test files (never expected now) still exits clean
    // rather than failing CI for an unrelated reason.
    passWithNoTests: true,
    coverage: {
      // The Phase 3b acceptance criterion, now enforced rather than just
      // stated: "packages/domain at 100% line and branch coverage on
      // money math" (CLAUDE.md, DOMAIN.md §7). `--coverage` fails the run
      // if any of these drop below 100 — run `pnpm test:coverage`, not
      // plain `test`, to check it (coverage instrumentation has a real
      // runtime cost, so it's opt-in, not the default `vitest run`).
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
