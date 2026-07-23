import { createHash } from "node:crypto";
import type { AIProvider, CompletionRequest, CompletionResult } from "./provider.js";

/**
 * ADR-0007 §1 — "the test suite runs against a deterministic stub
 * provider so AI-adjacent tests are not flaky and cost nothing." Same
 * input always produces the same output (hash-derived, not random), so a
 * fixture-based eval-harness assertion is reproducible across runs and
 * across machines — no network call, no API key needed, no per-run cost.
 *
 * Not a mock of any real model's behaviour — it doesn't try to produce
 * plausible prose. It exists to make the SPINE (budget guard, cache,
 * timeout, degradation) testable independently of a real model, and to
 * give the eval harness something to run against in CI without a key.
 */
export class StubProvider implements AIProvider {
  readonly id = "stub";
  readonly costPer1kTokens = { input: 0, output: 0 };

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const hash = createHash("sha256").update(req.system ?? "").update(req.prompt).digest("hex").slice(0, 12);
    const text = `stub-response-${hash}`;
    // Deterministic "token" counts derived from input length, not a real
    // tokenizer — good enough for budget-guard arithmetic tests, which
    // only need consistency, not tokenizer accuracy.
    const inputTokens = Math.ceil(((req.system?.length ?? 0) + req.prompt.length) / 4);
    const outputTokens = Math.min(req.maxTokens, Math.ceil(text.length / 4));
    return { text, inputTokens, outputTokens };
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      const hash = createHash("sha256").update(text).digest();
      // 384 dims to match gte-small / menu_items.embedding vector(384) —
      // cycling the hash bytes into [-1, 1] floats, deterministic per text.
      const vec: number[] = [];
      for (let i = 0; i < 384; i++) {
        vec.push((hash[i % hash.length]! / 127.5) - 1);
      }
      return vec;
    });
  }
}
