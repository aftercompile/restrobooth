import { describe, it, expect } from "vitest";
import { runEvalSuite, summarizeEvalResults } from "./harness.js";
import { upsellEvalScenarios, upsellFallbackScenarios } from "./upsell.eval.js";

describe("upsell eval suite", () => {
  it("passes every scenario", async () => {
    const results = [...(await runEvalSuite(upsellEvalScenarios)), ...(await runEvalSuite(upsellFallbackScenarios))];
    const summary = summarizeEvalResults(results);
    const failures = results.filter((r) => !r.pass).map((r) => `${r.name}: ${r.reason}`);
    expect(failures, failures.join("\n")).toEqual([]);
    expect(summary.allPassed).toBe(true);
  });
});
