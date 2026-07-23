import { describe, it, expect } from "vitest";
import { OpenRouterProvider } from "./openRouterProvider.js";

/**
 * A REAL call to OpenRouter — deliberately separate from the rest of the
 * suite (`.live.test.ts`, not picked up unless OPENROUTER_API_KEY is set)
 * so this package's normal test run stays what ADR-0007 §1 promises:
 * free, fast, and never flaky on a missing/rate-limited key. This file
 * exists so "the spine actually talks to a real model" is provable on
 * demand, not just asserted.
 */
const apiKey = process.env.OPENROUTER_API_KEY;

describe.skipIf(!apiKey)("OpenRouterProvider (live)", () => {
  it("completes a real request against openai/gpt-oss-20b:free", async () => {
    const provider = new OpenRouterProvider({
      model: "openai/gpt-oss-20b:free",
      apiKey: apiKey!,
      costPer1kTokens: { input: 0, output: 0 },
    });

    // gpt-oss-20b is a reasoning model — it spends part of its token
    // budget on hidden chain-of-thought before any visible `content`.
    // A too-small maxTokens (tried 20 first) hits finish_reason:"length"
    // mid-reasoning and returns content: null, not a short answer — this
    // isn't a bug, it's a real characteristic worth 300+ tokens of
    // headroom for even a one-word answer. See DECISIONS.md for the full
    // finding, including observed free-tier latency (30s+ in testing —
    // directly relevant to Slice 2's 1200ms Booth-facing budget).
    const result = await provider.complete({
      system: "Reply with exactly one word: the color of a ripe tomato.",
      prompt: "What color is it?",
      maxTokens: 300,
      temperature: 0,
    });

    expect(result.text.length).toBeGreaterThan(0);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
  }, 60_000);

  it("embed() throws — this provider is completion-only (ADR-0007 §2)", async () => {
    const provider = new OpenRouterProvider({
      model: "openai/gpt-oss-20b:free",
      apiKey: apiKey!,
      costPer1kTokens: { input: 0, output: 0 },
    });
    await expect(provider.embed(["test"])).rejects.toThrow(/does not embed/);
  });
});
