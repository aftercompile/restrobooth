import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tokens + the 10 primitives land later in Phase 1 (a separate
    // checkpoint). This is an empty, correctly-wired shell until then.
    passWithNoTests: true,
  },
});
