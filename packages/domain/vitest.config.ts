import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Phase 1 ships this package as an empty, correctly-wired shell —
    // the money math lands in Phase 3b. An empty package with no test
    // files should not fail CI.
    passWithNoTests: true,
    coverage: {
      // Phase 3b acceptance criterion: 100% line and branch coverage
      // on this package. Thresholds are enforced once real code lands.
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
