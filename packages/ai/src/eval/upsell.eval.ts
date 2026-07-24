import { fallbackReason, parseReasons, type RankedCandidate } from "../upsell.js";
import type { EvalScenario } from "./harness.js";

/**
 * Phase 6 Slice 5 (the phase gate) — RESTROBOOTH_BRIEF.md §3: "an eval
 * harness... so recommendation quality is measurable, not vibes." Slice 3
 * shipped upsell without ever wiring real scenarios into the harness
 * (found while building Slice 4's own eval suite, the first slice that
 * did). Same discipline as reviewExtraction.eval.ts: assert the
 * DETERMINISTIC contract (the fallback template, and what the parser
 * accepts/rejects from a model's raw text) — never grade LLM prose. No
 * DB, no network; `getRankedCandidates` (the real SQL shortlist) is
 * exercised by live Playwright verification, not this suite.
 */

const CANDIDATES: RankedCandidate[] = [
  { candidateId: "c1", candidateName: "Truffle Fries", pricePaise: "45000", pairedWithId: "p1", pairedWithName: "Filet Mignon", lift: 3.2 },
  { candidateId: "c2", candidateName: "Prawn Cocktail", pricePaise: "45000", pairedWithId: "p1", pairedWithName: "Filet Mignon", lift: 1.8 },
];

export const upsellEvalScenarios: EvalScenario<string, Record<string, string>>[] = [
  {
    name: "upsell parser: accepts reasons for known candidate ids",
    input: JSON.stringify({ c1: "Perfect with your Filet Mignon", c2: "Our chef recommends this alongside your Filet Mignon" }),
    run: async (text) => parseReasons(text, CANDIDATES),
    assert: (out) =>
      Object.keys(out).length === 2 && out.c1 === "Perfect with your Filet Mignon"
        ? { pass: true }
        : { pass: false, reason: `expected both known ids resolved, got ${JSON.stringify(out)}` },
  },
  {
    name: "upsell parser: drops a reason for an id that isn't a real candidate",
    input: JSON.stringify({ c1: "Perfect with your Filet Mignon", "not-a-real-id": "invented reason" }),
    run: async (text) => parseReasons(text, CANDIDATES),
    assert: (out) =>
      Object.keys(out).length === 1 && !("not-a-real-id" in out) ? { pass: true } : { pass: false, reason: `expected only c1, got ${JSON.stringify(out)}` },
  },
  {
    name: "upsell parser: tolerates markdown/prose wrapping the JSON object",
    input: 'Here are the suggestions:\n```json\n{"c1": "Perfect with your Filet Mignon"}\n```',
    run: async (text) => parseReasons(text, CANDIDATES),
    assert: (out) => (out.c1 === "Perfect with your Filet Mignon" ? { pass: true } : { pass: false, reason: `expected c1 resolved, got ${JSON.stringify(out)}` }),
  },
  {
    name: "upsell parser: unparseable text yields nothing, not a guess",
    input: "not json at all",
    run: async (text) => parseReasons(text, CANDIDATES),
    assert: (out) => (Object.keys(out).length === 0 ? { pass: true } : { pass: false, reason: `expected empty, got ${JSON.stringify(out)}` }),
  },
];

export const upsellFallbackScenarios: EvalScenario<RankedCandidate, string>[] = [
  {
    name: "upsell fallback: always names the real paired dish, never invents one",
    input: CANDIDATES[0]!,
    run: async (c) => fallbackReason(c),
    assert: (out) => (out === "Guests who ordered Filet Mignon loved this too" ? { pass: true } : { pass: false, reason: `got "${out}"` }),
  },
];
