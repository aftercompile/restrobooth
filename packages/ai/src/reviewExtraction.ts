import { sql, type Database, type RlsTx } from "@restrobooth/db";
import type { AIProvider } from "./provider.js";
import { OpenRouterProvider } from "./openRouterProvider.js";
import { withTimeout } from "./timeout.js";
import { checkBudget, recordUsage } from "./budgetGuard.js";
import { cacheKey, getCached, setCached } from "./cache.js";

/**
 * Review → Action — RESTROBOOTH_BRIEF.md §5B: "Post-meal QR feedback +
 * pasted aggregator reviews → structured extraction (aspect / sentiment /
 * dish reference) into a typed table." Unlike the Booth Host and upsell
 * (SQL ranks, the LLM only writes prose), THIS slice's real work — turning
 * free text into structured findings — genuinely is an LLM task. It is
 * still bounded, the same governing discipline applied differently: every
 * returned aspect/sentiment must be in a closed set, and every dish
 * reference is resolved against the store's REAL menu names by
 * `matchDishName` — the model can propose a dish phrase, never a final id.
 * A finding that fails any check is dropped, never stored fuzzy.
 *
 * AI-off (no key / over budget / timeout / unparseable) falls back to
 * `classifyByKeywords` — a deterministic rule-based pass over unambiguous
 * cue words, still producing real (if cruder) findings with `aiUsed:
 * false`, never an empty result. ADR-0007 §3's "product still works" the
 * same way upsell's "Often ordered with X" fallback does.
 */

export type ReviewAspect = "taste" | "portion" | "temperature" | "wait" | "price" | "service";
export type ReviewSentiment = "positive" | "neutral" | "negative";

export interface ExtractedFinding {
  aspect: ReviewAspect;
  sentiment: ReviewSentiment;
  /** A real menu_items.id for this store's brand, or null — never a name
   *  the model invented. See `matchDishName`. */
  menuItemId: string | null;
  snippet: string;
}

export interface ReviewExtractionResult {
  findings: ExtractedFinding[];
  aiUsed: boolean;
}

export interface MenuNameCandidate {
  id: string;
  name: string;
}

const EXTRACTION_TIMEOUT_MS = 30_000; // console-analysis budget (timeout.ts's own comment) — never the 1200ms guest budget; this runs from a staff Console action, not a guest page render.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // same safety-net TTL as upsell/booth-host; the content-hash key (review text itself) barely changes so this is mostly moot.

const ASPECTS = new Set<ReviewAspect>(["taste", "portion", "temperature", "wait", "price", "service"]);
const SENTIMENTS = new Set<ReviewSentiment>(["positive", "neutral", "negative"]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Deterministic, no fuzzy-matching dependency (CLAUDE.md rule 10 — ask
 * before adding one; this doesn't need one). Exact match first, then
 * substring containment either direction, then "every significant token
 * of the proposed name appears in one real candidate." Ambiguous or no
 * match → honest null, never a guess — a review mentioning "the steak"
 * when a store has three steaks should not silently pick one.
 */
export function matchDishName(rawName: string, candidates: MenuNameCandidate[]): string | null {
  const target = normalize(rawName);
  if (!target) return null;

  const exact = candidates.find((c) => normalize(c.name) === target);
  if (exact) return exact.id;

  const containing = candidates.filter((c) => {
    const name = normalize(c.name);
    return name.length > 0 && (name.includes(target) || target.includes(name));
  });
  if (containing.length === 1) return containing[0]!.id;
  if (containing.length > 1) {
    // Prefer whichever candidate's name is closest in length to the
    // proposed phrase — the most specific match among several containments
    // (e.g. "steak" containing both "Ribeye Steak" and "New York Strip
    // Steak" — closest length wins over an arbitrary first match).
    const sorted = [...containing].sort(
      (a, b) => Math.abs(normalize(a.name).length - target.length) - Math.abs(normalize(b.name).length - target.length),
    );
    return sorted[0]!.id;
  }

  const targetTokens = target.split(" ").filter((w) => w.length >= 4);
  if (targetTokens.length === 0) return null;
  const tokenMatches = candidates.filter((c) => {
    const name = normalize(c.name);
    return targetTokens.every((t) => name.includes(t));
  });
  return tokenMatches.length === 1 ? tokenMatches[0]!.id : null;
}

function findMentionedDish(text: string, candidates: MenuNameCandidate[]): string | null {
  const norm = normalize(text);
  const mentioned = candidates.filter((c) => {
    const name = normalize(c.name);
    return name.length >= 4 && norm.includes(name);
  });
  if (mentioned.length === 0) return null;
  // Longest real name mentioned wins — "Grilled Asparagus" beats a
  // coincidental shorter substring match elsewhere in the menu.
  mentioned.sort((a, b) => b.name.length - a.name.length);
  return mentioned[0]!.id;
}

interface KeywordRule {
  pattern: RegExp;
  aspect: ReviewAspect;
  sentiment: ReviewSentiment;
}

/** Unambiguous cue words only — this is the AI-off floor, not an attempt
 *  at real sentiment analysis. Every rule pairs a cue with a fixed
 *  aspect+sentiment; there is no scoring, no negation handling — a review
 *  this can't confidently read about produces zero findings, which is
 *  honest (nothing found), not a guess dressed up as a finding. */
const KEYWORD_RULES: KeywordRule[] = [
  { pattern: /\b(cold|lukewarm)\b/i, aspect: "temperature", sentiment: "negative" },
  { pattern: /\b(piping hot|hot and fresh|served hot)\b/i, aspect: "temperature", sentiment: "positive" },
  { pattern: /\b(slow|waited (forever|ages|a long time)|long wait|took forever)\b/i, aspect: "wait", sentiment: "negative" },
  { pattern: /\b(quick|fast service|prompt service|no wait)\b/i, aspect: "wait", sentiment: "positive" },
  { pattern: /\b(expensive|overpriced|pricey)\b/i, aspect: "price", sentiment: "negative" },
  { pattern: /\b(good value|worth (it|the price)|reasonably priced)\b/i, aspect: "price", sentiment: "positive" },
  { pattern: /\b(small|tiny|skimpy) portion/i, aspect: "portion", sentiment: "negative" },
  { pattern: /\b(generous|huge|large) portion/i, aspect: "portion", sentiment: "positive" },
  { pattern: /\b(rude|unfriendly|inattentive|ignored us)\b/i, aspect: "service", sentiment: "negative" },
  { pattern: /\b(friendly|attentive|helpful|welcoming)\s+(staff|service|server|waiter|waitress)\b/i, aspect: "service", sentiment: "positive" },
  { pattern: /\b(bland|tasteless|bad taste|didn'?t taste (right|good))\b/i, aspect: "taste", sentiment: "negative" },
  { pattern: /\b(delicious|tasty|amazing|perfect(ly cooked)?|flavou?rful|scrumptious)\b/i, aspect: "taste", sentiment: "positive" },
];

export function classifyByKeywords(reviewText: string, candidates: MenuNameCandidate[]): ExtractedFinding[] {
  const menuItemId = findMentionedDish(reviewText, candidates);
  const findings: ExtractedFinding[] = [];
  for (const rule of KEYWORD_RULES) {
    const match = rule.pattern.exec(reviewText);
    if (match) findings.push({ aspect: rule.aspect, sentiment: rule.sentiment, menuItemId, snippet: match[0] });
  }
  return findings;
}

interface RawFinding {
  aspect?: unknown;
  sentiment?: unknown;
  dish?: unknown;
  snippet?: unknown;
}

/** Never trusts the model's shape, only its content — same discipline as
 *  upsell.ts's `parseReasons`: strip any prose/fence wrapping, parse, then
 *  validate every field against a closed set before accepting it. Any
 *  finding that fails a check is silently dropped, not coerced. */
export function parseExtractionResponse(text: string, candidates: MenuNameCandidate[]): ExtractedFinding[] {
  try {
    const match = /\[[\s\S]*\]/.exec(text);
    if (!match) return [];
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];

    const out: ExtractedFinding[] = [];
    for (const raw of parsed as RawFinding[]) {
      if (typeof raw !== "object" || raw === null) continue;
      const { aspect, sentiment, dish, snippet } = raw;
      if (typeof aspect !== "string" || !ASPECTS.has(aspect as ReviewAspect)) continue;
      if (typeof sentiment !== "string" || !SENTIMENTS.has(sentiment as ReviewSentiment)) continue;
      if (typeof snippet !== "string" || snippet.trim().length === 0) continue;
      const dishName = typeof dish === "string" ? dish.trim() : "";
      const menuItemId = dishName ? matchDishName(dishName, candidates) : null;
      out.push({ aspect: aspect as ReviewAspect, sentiment: sentiment as ReviewSentiment, menuItemId, snippet: snippet.trim() });
    }
    return out;
  } catch {
    return [];
  }
}

function getProvider(): AIProvider | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return new OpenRouterProvider({ model: "openai/gpt-oss-20b:free", apiKey, costPer1kTokens: { input: 0, output: 0 }, id: "openai/gpt-oss-20b:free" });
}

const EXTRACTION_SYSTEM_PROMPT =
  "You read a restaurant guest review and extract distinct findings. For each notable point about taste, " +
  "portion size, temperature, wait time, price, or service, output one finding. Reply with ONLY a JSON " +
  "array, no markdown, no code fences, no extra text. Each element must be exactly: " +
  '{"aspect": one of "taste" | "portion" | "temperature" | "wait" | "price" | "service", ' +
  '"sentiment": one of "positive" | "neutral" | "negative", ' +
  '"dish": the specific dish name the point is about, or null if it is general, ' +
  '"snippet": a short supporting quote or paraphrase, under 15 words}. ' +
  "If nothing analyzable is in the review, reply with []. Never invent facts you weren't given.";

function buildExtractionPrompt(reviewText: string): string {
  return `Extract findings from this guest review:\n"""\n${reviewText}\n"""`;
}

/** Real, store-scoped menu vocabulary for dish matching — via
 *  resolve_menu() so a sibling brand's identically-named dish at a
 *  different store never matches (same scoping upsell.ts and
 *  booth-host.ts already rely on). Deliberately NOT filtered to
 *  currently-available items: a review can reference a dish that's since
 *  been 86'd or discontinued, which is still a real historical fact worth
 *  recording, unlike a live recommendation which must never surface it. */
async function getStoreMenuNames(db: Database | RlsTx, storeId: string): Promise<MenuNameCandidate[]> {
  const result = await db.execute<{ [key: string]: unknown; menu_item_id: string; name: string }>(sql`
    select distinct rm.menu_item_id, mi.name
    from resolve_menu(${storeId}, 'dinein') rm
    join menu_items mi on mi.id = rm.menu_item_id
  `);
  return result.rows.map((r) => ({ id: r.menu_item_id, name: r.name }));
}

export interface ExtractReviewAspectsParams {
  outletId: string;
  storeId: string;
  reviewText: string;
}

/** `db` accepts either a top-level `Database` (a privileged connection,
 *  matching upsell.ts/booth-host.ts's guest-path callers) or an `RlsTx`
 *  (Console's `queryAsCurrentUser` — this feature's only current caller,
 *  a staff-triggered action that should run under RLS, not bypass it). */
export async function extractReviewAspects(db: Database | RlsTx, params: ExtractReviewAspectsParams): Promise<ReviewExtractionResult> {
  const menuNames = await getStoreMenuNames(db, params.storeId);
  const fallback = (): ReviewExtractionResult => ({ findings: classifyByKeywords(params.reviewText, menuNames), aiUsed: false });

  const provider = getProvider();
  if (!provider) return fallback();

  const budgetStatus = await db.transaction((tx) => checkBudget(tx, params.outletId));
  if (!budgetStatus.allowed) return fallback();

  const key = cacheKey("review_extraction", [params.storeId, params.reviewText]);
  const cached = await db.transaction((tx) => getCached(tx, key));
  if (cached) return { findings: JSON.parse(cached) as ExtractedFinding[], aiUsed: true };

  const prompt = buildExtractionPrompt(params.reviewText);
  const result = await withTimeout(
    provider.complete({ system: EXTRACTION_SYSTEM_PROMPT, prompt, maxTokens: 1000, temperature: 0.2 }),
    EXTRACTION_TIMEOUT_MS,
  );
  if (!result) return fallback();

  const findings = parseExtractionResponse(result.text, menuNames);
  if (findings.length === 0) return fallback();

  const businessDate = new Date().toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    await recordUsage(tx, {
      outletId: params.outletId,
      storeId: params.storeId,
      businessDate,
      feature: "review_extraction",
      providerId: provider.id,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costPaise: 0n,
    });
    await setCached(tx, key, "review_extraction", JSON.stringify(findings), CACHE_TTL_MS);
  });

  return { findings, aiUsed: true };
}
