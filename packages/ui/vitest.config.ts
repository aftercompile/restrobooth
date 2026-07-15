import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Pure-logic unit tests only (money math). Component rendering is
    // verified against the running app, not jsdom — the things that break
    // are RLS, money, and real browser behaviour, none of which a shallow
    // render proves. passWithNoTests stays on so an empty run is green.
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
