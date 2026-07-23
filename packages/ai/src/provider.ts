/**
 * ADR-0007 §1 — the provider interface. No vendor is hard-coded; every AI
 * surface (Booth Host, upsell, review extraction, ...) codes against this,
 * never against a specific SDK. Model IDs are configuration passed into a
 * provider's constructor, not compiled in — they change.
 *
 * `embed` exists on the interface for testability (the stub provider
 * returns a deterministic fake embedding so tests never need real vector
 * math), but the REAL, production embedding path is local and free —
 * gte-small via a Supabase Edge Function into `menu_items.embedding`
 * (ADR-0007 §2) — and does not go through a paid provider's `embed()` at
 * all. That local pipeline lands in Slice 2 (Booth Host), the first
 * feature that actually needs it.
 */
export interface CompletionRequest {
  /** System/instruction context — kept separate from `prompt` so a
   *  provider can place it correctly for its own API shape (a top-level
   *  field for some APIs, a `role: "system"` message for OpenAI-style
   *  chat-completions endpoints like OpenRouter's). */
  system?: string;
  prompt: string;
  maxTokens: number;
  /** Omitted = provider default. Booth-facing reason-copy calls want low
   *  temperature (consistent, not creative); free-text intake parsing
   *  wants near-zero. Never left as a hidden default inside a provider. */
  temperature?: number;
}

export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AIProvider {
  /** Stable identity for cost attribution (ai_usage_ledger.provider_id) —
   *  e.g. "claude-haiku-4.5", "claude-sonnet-5", "stub". Not the vendor
   *  name alone: two models from the same vendor have different costs. */
  readonly id: string;
  readonly costPer1kTokens: { input: number; output: number };
  complete(req: CompletionRequest): Promise<CompletionResult>;
  embed(texts: string[]): Promise<number[][]>;
}
