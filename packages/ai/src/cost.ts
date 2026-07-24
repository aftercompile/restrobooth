/**
 * `ai_usage_ledger.cost_paise` is INR paise — this codebase's one money
 * unit (CLAUDE.md: "money is bigint paise, never floats"). `AIProvider`'s
 * own `costPer1kTokens` is USD, OpenRouter's native pricing unit. This is
 * an OPERATIONAL cost-tracking ledger, not the guest bill CLAUDE.md's
 * money non-negotiable governs (that's `invoicing.ts`'s `bills` table,
 * which the AI never touches — ADR-0007 §6) — so a rough, clearly-
 * approximate USD→INR rate is an honest, proportionate choice here, not
 * a real-money settlement figure that needs to be exact to the paisa.
 */
const APPROX_USD_TO_INR = 83;

export function estimateCostPaise(costPer1kTokens: { input: number; output: number }, inputTokens: number, outputTokens: number): bigint {
  const usd = (inputTokens / 1000) * costPer1kTokens.input + (outputTokens / 1000) * costPer1kTokens.output;
  return BigInt(Math.round(usd * APPROX_USD_TO_INR * 100));
}
