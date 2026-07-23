import type { AIProvider, CompletionRequest, CompletionResult } from "./provider.js";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterProviderConfig {
  /** Configuration, not a compiled-in constant (ADR-0007 §1: "model IDs
   *  are configuration, not code — they change"). e.g.
   *  "openai/gpt-oss-20b:free" — the owner's chosen default, free and
   *  unlimited on OpenRouter as of this writing. */
  model: string;
  apiKey: string;
  costPer1kTokens: { input: number; output: number };
  /** A stable id distinct from `model` for cost attribution. Defaults to
   *  `model`. */
  id?: string;
}

/**
 * ADR-0007's primary provider — amended 2026-07-23: OpenRouter, not
 * Anthropic directly (the ADR's original "Primary: Anthropic Claude"
 * pick), owner's explicit call. OpenRouter's chat-completions endpoint is
 * OpenAI-compatible, so this shape is reusable for ANY OpenRouter-hosted
 * model by changing `model` in config — not just the current
 * "openai/gpt-oss-20b:free" default.
 *
 * Plain `fetch`, not a vendor SDK — same reasoning as the rest of this
 * package: a small, stable JSON contract doesn't earn a new dependency
 * (CLAUDE.md #10).
 *
 * No timeout/retry/degradation logic here — that's `withTimeout` (ADR-0007
 * §3), composed around whichever provider is in use, not duplicated per
 * provider.
 */
export class OpenRouterProvider implements AIProvider {
  readonly id: string;
  readonly costPer1kTokens: { input: number; output: number };
  private readonly model: string;
  private readonly apiKey: string;

  constructor(config: OpenRouterProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.costPer1kTokens = config.costPer1kTokens;
    this.id = config.id ?? config.model;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
        messages: [
          ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
          { role: "user" as const, content: req.prompt },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter API error ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices: { message: { content: string } }[];
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    const text = data.choices[0]?.message.content ?? "";
    return { text, inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens };
  }

  async embed(_texts: string[]): Promise<number[][]> {
    // ADR-0007 §2: embeddings are local (gte-small via a Supabase Edge
    // Function), never a paid/hosted-model call — kept out of this
    // provider's job regardless of which chat model sits behind it.
    throw new Error("OpenRouterProvider does not embed — use the local gte-small pipeline (ADR-0007 §2, lands in Slice 2).");
  }
}
