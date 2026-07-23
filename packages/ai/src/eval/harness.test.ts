import { describe, it, expect } from "vitest";
import { runEvalSuite, summarizeEvalResults, type EvalScenario } from "./harness.js";

describe("runEvalSuite / summarizeEvalResults", () => {
  const scenarios: EvalScenario<number, number>[] = [
    { name: "doubles 2", input: 2, run: async (n) => n * 2, assert: (out) => ({ pass: out === 4 }) },
    { name: "doubles 3, wrong expectation", input: 3, run: async (n) => n * 2, assert: (out) => ({ pass: out === 999, reason: `expected 999, got ${out}` }) },
    {
      name: "throws",
      input: 0,
      run: async () => {
        throw new Error("provider unavailable");
      },
      assert: () => ({ pass: true }),
    },
  ];

  it("runs every scenario even when one throws or fails, and reports per-scenario pass/fail", async () => {
    const results = await runEvalSuite(scenarios);
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ name: "doubles 2", pass: true });
    expect(results[1]).toMatchObject({ name: "doubles 3, wrong expectation", pass: false, reason: "expected 999, got 6" });
    expect(results[2]).toMatchObject({ name: "throws", pass: false, reason: "provider unavailable" });
  });

  it("summarizes pass/fail counts correctly", async () => {
    const results = await runEvalSuite(scenarios);
    const summary = summarizeEvalResults(results);
    expect(summary).toEqual({ total: 3, passed: 1, failed: 2, allPassed: false });
  });

  it("allPassed is true only when every scenario passes", async () => {
    const allGood: EvalScenario<number, number>[] = [
      { name: "a", input: 1, run: async (n) => n, assert: () => ({ pass: true }) },
      { name: "b", input: 2, run: async (n) => n, assert: () => ({ pass: true }) },
    ];
    const summary = summarizeEvalResults(await runEvalSuite(allGood));
    expect(summary.allPassed).toBe(true);
  });
});
