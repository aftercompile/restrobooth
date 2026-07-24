import { classifyByKeywords, parseExtractionResponse, type ExtractedFinding, type MenuNameCandidate } from "../reviewExtraction.js";
import type { EvalScenario } from "./harness.js";

/**
 * Phase 6 Slice 4's eval harness — RESTROBOOTH_BRIEF.md §5: "a fixed set
 * of scenarios with expected-quality assertions, so quality is measurable
 * and not vibes." Same discipline as Slice 2's Booth Host eval would use:
 * assert against the DETERMINISTIC contract, never grade LLM prose. Here
 * that means exercising the two pure functions that decide whether a
 * finding is EVER accepted — `classifyByKeywords` (the AI-off floor every
 * review always gets) and `parseExtractionResponse` (the validator that
 * bounds whatever the LLM proposes) — against fixed review-text fixtures,
 * with no DB and no network. `extractReviewAspects` itself (the real
 * orchestration, needing a live DB for `resolve_menu()`) is exercised by
 * live Playwright verification, not this suite.
 */

const MENU: MenuNameCandidate[] = [
  { id: "asparagus", name: "Grilled Asparagus" },
  { id: "filet", name: "Filet Mignon" },
  { id: "ribeye", name: "Ribeye Steak" },
  { id: "cake", name: "Chocolate Lava Cake" },
];

function has(findings: ExtractedFinding[], aspect: string, sentiment: string): boolean {
  return findings.some((f) => f.aspect === aspect && f.sentiment === sentiment);
}

export const keywordFallbackScenarios: EvalScenario<string, ExtractedFinding[]>[] = [
  {
    name: "keyword fallback: cold food is a negative temperature finding",
    input: "The filet mignon arrived cold and we had to send it back.",
    run: async (text) => classifyByKeywords(text, MENU),
    assert: (out) => {
      if (!has(out, "temperature", "negative")) return { pass: false, reason: "expected a negative temperature finding" };
      if (!out.every((f) => f.menuItemId === "filet")) return { pass: false, reason: "expected every finding attached to Filet Mignon" };
      return { pass: true };
    },
  },
  {
    name: "keyword fallback: slow service is a negative wait finding",
    input: "We waited forever for our table and the server ignored us afterward.",
    run: async (text) => classifyByKeywords(text, MENU),
    assert: (out) =>
      has(out, "wait", "negative") && has(out, "service", "negative")
        ? { pass: true }
        : { pass: false, reason: `expected wait+service negative findings, got ${JSON.stringify(out)}` },
  },
  {
    name: "keyword fallback: praise for taste and portion is positive",
    input: "The ribeye steak was delicious with a generous portion — great value too.",
    run: async (text) => classifyByKeywords(text, MENU),
    assert: (out) => {
      if (!has(out, "taste", "positive")) return { pass: false, reason: "expected a positive taste finding" };
      if (!has(out, "portion", "positive")) return { pass: false, reason: "expected a positive portion finding" };
      if (!out.every((f) => f.menuItemId === "ribeye")) return { pass: false, reason: "expected every finding attached to Ribeye Steak" };
      return { pass: true };
    },
  },
  {
    name: "keyword fallback: unmentioned dish never gets a menuItemId invented",
    input: "The chocolate lava cake was bland, honestly.",
    run: async (text) => classifyByKeywords(text, MENU),
    assert: (out) => (out.every((f) => f.menuItemId === "cake") ? { pass: true } : { pass: false, reason: "expected findings attached to the real cake id" }),
  },
  {
    name: "keyword fallback: no unambiguous cues produces zero findings, not a guess",
    input: "We celebrated a birthday here on a Friday night.",
    run: async (text) => classifyByKeywords(text, MENU),
    assert: (out) => (out.length === 0 ? { pass: true } : { pass: false, reason: `expected no findings, got ${JSON.stringify(out)}` }),
  },
];

export const parserValidationScenarios: EvalScenario<string, ExtractedFinding[]>[] = [
  {
    name: "parser: accepts a well-formed finding and resolves a real dish",
    input: JSON.stringify([{ aspect: "taste", sentiment: "positive", dish: "Grilled Asparagus", snippet: "perfectly charred" }]),
    run: async (text) => parseExtractionResponse(text, MENU),
    assert: (out) =>
      out.length === 1 && out[0]!.menuItemId === "asparagus" ? { pass: true } : { pass: false, reason: `expected 1 resolved finding, got ${JSON.stringify(out)}` },
  },
  {
    name: "parser: never invents a menu_item_id for a dish that isn't on this menu",
    input: JSON.stringify([{ aspect: "taste", sentiment: "negative", dish: "Beef Wellington", snippet: "not what we ordered" }]),
    run: async (text) => parseExtractionResponse(text, MENU),
    assert: (out) => (out.length === 1 && out[0]!.menuItemId === null ? { pass: true } : { pass: false, reason: `expected a null dish match, got ${JSON.stringify(out)}` }),
  },
  {
    name: "parser: drops a finding whose aspect isn't in the closed set",
    input: JSON.stringify([{ aspect: "ambiance", sentiment: "positive", dish: null, snippet: "lovely decor" }]),
    run: async (text) => parseExtractionResponse(text, MENU),
    assert: (out) => (out.length === 0 ? { pass: true } : { pass: false, reason: "expected the finding to be dropped" }),
  },
  {
    name: "parser: tolerates markdown/prose wrapping the JSON array",
    input: 'Sure, here are the findings:\n```json\n[{"aspect":"wait","sentiment":"negative","dish":null,"snippet":"30 minute wait"}]\n```\nHope that helps!',
    run: async (text) => parseExtractionResponse(text, MENU),
    assert: (out) => (out.length === 1 && out[0]!.aspect === "wait" ? { pass: true } : { pass: false, reason: `expected 1 wait finding, got ${JSON.stringify(out)}` }),
  },
];

export const reviewExtractionEvalScenarios = [...keywordFallbackScenarios, ...parserValidationScenarios];
