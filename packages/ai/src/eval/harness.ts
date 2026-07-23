/**
 * ADR-0007 / RESTROBOOTH_BRIEF.md §5: "an eval harness — a fixed set of
 * guest-preference scenarios with expected-quality assertions, so
 * recommendation quality is measurable and not vibes." This is the
 * mechanism, reusable across every AI surface; Slice 1 ships it with no
 * real scenarios yet (there's no feature to evaluate). Slice 2's Booth
 * Host is the first real consumer — its fixture scenarios assert against
 * the DETERMINISTIC SQL shortlist (never the LLM's prose), which is what
 * makes this meaningfully testable at all rather than a vibe check.
 */
export interface EvalScenario<TInput, TOutput> {
  name: string;
  input: TInput;
  run: (input: TInput) => Promise<TOutput>;
  /** A pure function, not an LLM-graded judgment — matches the governing
   *  principle (deterministic math first) all the way down into how
   *  quality itself gets measured. */
  assert: (output: TOutput) => { pass: boolean; reason?: string };
}

export interface EvalResult {
  name: string;
  pass: boolean;
  reason?: string;
  durationMs: number;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
}

/** A scenario that throws (provider down, network error, bad fixture)
 *  fails that scenario — it does not abort the suite. One bad fixture
 *  should never hide every other scenario's result. */
export async function runEvalSuite<TInput, TOutput>(scenarios: EvalScenario<TInput, TOutput>[]): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const scenario of scenarios) {
    const start = Date.now();
    try {
      const output = await scenario.run(scenario.input);
      const { pass, reason } = scenario.assert(output);
      results.push(reason === undefined
        ? { name: scenario.name, pass, durationMs: Date.now() - start }
        : { name: scenario.name, pass, reason, durationMs: Date.now() - start });
    } catch (err) {
      results.push({
        name: scenario.name,
        pass: false,
        reason: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      });
    }
  }
  return results;
}

export function summarizeEvalResults(results: EvalResult[]): EvalSummary {
  const passed = results.filter((r) => r.pass).length;
  return { total: results.length, passed, failed: results.length - passed, allPassed: passed === results.length };
}
