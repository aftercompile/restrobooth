import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    globalSetup: ["./test/globalSetup.ts"],
    // test/override mutates a single shared set of rows per test case
    // (setOverrides replaces ALL overrides for the test item each time) —
    // those tests must run in strict sequence, not across worker threads.
    fileParallelism: false,
  },
});
