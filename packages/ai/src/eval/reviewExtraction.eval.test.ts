import { describe, it, expect } from "vitest";
import { runEvalSuite, summarizeEvalResults } from "./harness.js";
import { reviewExtractionEvalScenarios } from "./reviewExtraction.eval.js";

/**
 * Phase 6 Slice 5's gate (RESTROBOOTH_BRIEF.md §3 / this slice's own plan)
 * requires "eval-harness green" — this is what makes that check real
 * instead of aspirational. Runs entirely offline (no DB, no provider).
 */
describe("review extraction eval suite", () => {
  it("passes every scenario", async () => {
    const results = await runEvalSuite(reviewExtractionEvalScenarios);
    const summary = summarizeEvalResults(results);
    const failures = results.filter((r) => !r.pass).map((r) => `${r.name}: ${r.reason}`);
    expect(failures, failures.join("\n")).toEqual([]);
    expect(summary.allPassed).toBe(true);
  });
});
