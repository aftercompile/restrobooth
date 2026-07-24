import { runEvalSuite, summarizeEvalResults, type EvalScenario } from "@restrobooth/ai";
import { fallbackReason, parseReasons, type RankedCandidate } from "./booth-host-reasons.js";

/**
 * Phase 6 Slice 5 (the phase gate) — same discipline as
 * packages/ai/src/eval/{upsell,reviewExtraction}.eval.ts, applied to the
 * Booth Host's own app-local deterministic contract: the fallback
 * template's every branch, and what the JSON parser accepts/rejects from
 * a model's raw text. `getRankedCandidates` (the real SQL shortlist) is
 * exercised by live Playwright verification, not this suite — no DB, no
 * network here, reusing the shared harness from packages/ai (the harness
 * is explicitly built to be reusable across every AI surface, app-local
 * or shared).
 */

function candidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  return {
    menuItemId: "m1",
    name: "Filet Mignon",
    description: "Center-cut tenderloin",
    pricePaise: "145000",
    tags: [],
    spiceLevel: null,
    matchedMood: false,
    matchedSpice: false,
    matchedBudget: false,
    popularity: 0,
    ...overrides,
  };
}

export const fallbackReasonScenarios: EvalScenario<RankedCandidate, string>[] = [
  {
    name: "fallback: matched spice + mood",
    input: candidate({ matchedSpice: true, matchedMood: true }),
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Matches your spice and mood picks" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
  {
    name: "fallback: matched mood only",
    input: candidate({ matchedMood: true }),
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Fits what you're in the mood for" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
  {
    name: "fallback: matched spice only",
    input: candidate({ matchedSpice: true }),
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Right at your spice level" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
  {
    name: "fallback: matched budget + real popularity",
    input: candidate({ matchedBudget: true, popularity: 12 }),
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Popular with guests, and in your budget" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
  {
    name: "fallback: real popularity only",
    input: candidate({ popularity: 12 }),
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Popular with similar guests" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
  {
    name: "fallback: matched budget only",
    input: candidate({ matchedBudget: true }),
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Fits your budget" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
  {
    name: "fallback: no signal at all — honest, not invented",
    input: candidate(),
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Worth trying" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
];

const CANDIDATES: RankedCandidate[] = [candidate({ menuItemId: "m1", name: "Filet Mignon" }), candidate({ menuItemId: "m2", name: "Ribeye Steak" })];

export const parserScenarios: EvalScenario<string, Record<string, string>>[] = [
  {
    name: "parser: accepts reasons for known dish ids",
    input: JSON.stringify({ m1: "A guest favorite, cooked to order", m2: "Char-grilled for a smoky crust" }),
    run: async (text) => parseReasons(text, CANDIDATES),
    assert: (out) => (Object.keys(out).length === 2 ? { pass: true } : { pass: false, reason: `expected 2, got ${JSON.stringify(out)}` }),
  },
  {
    name: "parser: never invents a reason for a dish not on the real shortlist",
    input: JSON.stringify({ m1: "A guest favorite", "not-a-real-dish": "invented" }),
    run: async (text) => parseReasons(text, CANDIDATES),
    assert: (out) => (Object.keys(out).length === 1 && out.m1 !== undefined ? { pass: true } : { pass: false, reason: `expected only m1, got ${JSON.stringify(out)}` }),
  },
  {
    name: "parser: unparseable text yields nothing, not a guess",
    input: "sorry, I can't help with that",
    run: async (text) => parseReasons(text, CANDIDATES),
    assert: (out) => (Object.keys(out).length === 0 ? { pass: true } : { pass: false, reason: `expected empty, got ${JSON.stringify(out)}` }),
  },
];

export async function runBoothHostEval() {
  const results = [...(await runEvalSuite(fallbackReasonScenarios)), ...(await runEvalSuite(parserScenarios))];
  return summarizeEvalResults(results);
}
