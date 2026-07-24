// Phase 6 Slice 1 — the AI spine (ADR-0007). Provider abstraction, budget
// guard, cache, hard degradation, and the eval harness. No user-facing
// feature yet — Slices 2-4 (Booth Host, upsell, review->action) are the
// consumers of everything exported here.

export type { AIProvider, CompletionRequest, CompletionResult } from "./provider.js";
export { OpenRouterProvider, type OpenRouterProviderConfig } from "./openRouterProvider.js";
export { StubProvider } from "./stubProvider.js";
export { withTimeout } from "./timeout.js";
export { checkBudget, recordUsage, type AIFeature, type BudgetStatus, type RecordUsageParams } from "./budgetGuard.js";
export { cacheKey, getCached, setCached } from "./cache.js";
export { runEvalSuite, summarizeEvalResults, type EvalScenario, type EvalResult, type EvalSummary } from "./eval/harness.js";
export { getUpsellSuggestions, type UpsellCandidate, type UpsellResult } from "./upsell.js";
