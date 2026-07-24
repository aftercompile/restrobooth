import { describe, it, expect } from "vitest";
import { runBoothHostEval } from "./booth-host.eval.js";

describe("booth host eval suite", () => {
  it("passes every scenario", async () => {
    const summary = await runBoothHostEval();
    expect(summary.allPassed, `failed: ${summary.failed}`).toBe(true);
  });
});
