import "server-only";
import { sql } from "@restrobooth/db";
import { OpenRouterProvider, withTimeout, checkBudget, recordUsage, getCached, setCached, cacheKey, type AIProvider } from "@restrobooth/ai";
import { getDb } from "./db";
import { fallbackReason, parseReasons, type RankedCandidate } from "./booth-host-reasons";

export type { RankedCandidate } from "./booth-host-reasons";

/**
 * The Booth Host — ADR-0007 §5A, the headline AI feature. Governing
 * principle restated because it's the whole architecture: the SHORTLIST
 * (which dishes) is deterministic SQL — rules (diet/allergens, hard;
 * never relaxed) + a scored ranking (spice/mood/budget match + real
 * historical popularity, soft signals). The LLM, when available, only
 * writes the per-dish REASON STRING. Turn the AI off and the exact same
 * shortlist still renders, just with plain templated reasons instead of
 * generated ones — ADR-0007 §3's hard requirement, not a nice-to-have.
 */

export type SpiceLevel = "mild" | "medium" | "hot";
export type Diet = "veg" | "non_veg" | "egg" | "jain";
export type BudgetBand = "low" | "mid" | "high";
export type Mood = "quick-bite" | "comfort" | "celebrating" | "light";

export interface BoothHostPreferences {
  mood?: Mood;
  spiceLevel?: SpiceLevel;
  diet?: Diet;
  budgetBand?: BudgetBand;
  avoidAllergens?: string[];
  freeText?: string;
}

export interface RecommendedItem {
  menuItemId: string;
  name: string;
  pricePaise: string;
  reason: string;
}

export interface BoothHostResult {
  items: RecommendedItem[];
  /** Whether a real LLM wrote the reasons (true) or the deterministic
   *  fallback template did (false) — surfaced so the UI/eval harness can
   *  tell the two apart without guessing from the text. */
  aiUsed: boolean;
}

// ADR-0007 §3 — hard, guest-facing. Raised from 1200ms (owner decision,
// 2026-07-24): real benchmarking against OpenRouter's actual free-tier
// models found NONE complete inside 1200ms (gpt-oss-20b: 10-24s;
// gemma-4-26b-a4b-it, the fastest correct-output free model: 3.7-7.6s on
// a 2-candidate benchmark prompt). Set to 10s, the top of the owner's
// stated 8-10s range — 9s was tried first and measured too tight live:
// this function's real SHORTLIST_LIMIT=5 prompt (more candidates, more
// output tokens than the 2-candidate benchmark) landed at 9116-9151ms
// against the real API twice in a row, consistently just over a 9000ms
// ceiling. The guest now sees an explicit "Personalizing your
// recommendation…" loading state (BoothHostIntake.tsx) for the wait
// instead of an instant-or-nothing fallback. The hard rule is unchanged
// — SOME response inside the budget, never an indefinite hang.
const BOOTH_TIMEOUT_MS = 10000;
const SHORTLIST_LIMIT = 5;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h — menu_version isn't tracked yet (Phase 2's resolver has no version counter), so this is the safety net against a stale cache outliving a same-day menu change, not the primary invalidation ADR-0007 §5 describes.

/** Tertiles of this store's own available prices — a fixed rupee
 *  threshold would be meaningless across stores as different as Spice
 *  Route (₹25 papad) and Ember & Oak (₹1450 filet mignon). */
async function budgetBoundsForStore(storeId: string): Promise<{ low: number; high: number }> {
  const db = getDb();
  const result = await db.execute<{ [key: string]: unknown; low: string | null; high: string | null }>(sql`
    select
      percentile_disc(0.33) within group (order by rm.price_paise) as low,
      percentile_disc(0.66) within group (order by rm.price_paise) as high
    from resolve_menu(${storeId}, 'dinein') rm
    where rm.is_available
  `);
  const row = result.rows[0];
  return { low: Number(row?.low ?? 0), high: Number(row?.high ?? 0) };
}

async function getRankedCandidates(storeId: string, prefs: BoothHostPreferences, limit: number): Promise<RankedCandidate[]> {
  const db = getDb();
  const { low, high } = await budgetBoundsForStore(storeId);
  const [budgetMin, budgetMax] =
    prefs.budgetBand === "low" ? [0, low] : prefs.budgetBand === "high" ? [high, Number.MAX_SAFE_INTEGER] : [low, high];

  // sql`${array}::text[]` does NOT bind a JS array as a single Postgres
  // array parameter — drizzle expands each element into its own scalar
  // placeholder, so `mi.allergens && $array::text[]` receives a bare
  // (a,b,c) ROW constructor and Postgres rejects the cast ("cannot cast
  // type record to text[]"). This path was never exercised with a real
  // non-empty avoidAllergens array during Slice 2's own live testing —
  // found and fixed alongside the identical bug in packages/ai/src/upsell.ts.
  // sql.join + an explicit array[...] constructor (the pattern this
  // codebase already uses for IN-lists) fixes it.
  const avoidAllergensArray =
    prefs.avoidAllergens && prefs.avoidAllergens.length > 0
      ? sql`array[${sql.join(
          prefs.avoidAllergens.map((a) => sql`${a}`),
          sql`, `,
        )}]::text[]`
      : sql`null::text[]`;

  const result = await db.execute<{
    [key: string]: unknown;
    menu_item_id: string;
    name: string;
    description: string | null;
    price_paise: string;
    tags: string[];
    spice_level: string | null;
    popularity: string;
  }>(sql`
    select mi.id as menu_item_id, mi.name, mi.description, rm.price_paise, mi.tags, mi.spice_level,
      coalesce(pop.qty_sold, 0) as popularity
    from resolve_menu(${storeId}, 'dinein') rm
    join menu_items mi on mi.id = rm.menu_item_id
    left join (
      select oi.menu_item_id, sum(oi.quantity) as qty_sold
      from order_items oi
      where oi.store_id = ${storeId} and oi.status != 'voided'
      group by oi.menu_item_id
    ) pop on pop.menu_item_id = mi.id
    where rm.is_available
      and (${prefs.diet ?? null}::text is null or mi.diet = ${prefs.diet ?? null})
      and (
        ${avoidAllergensArray} is null
        or not (mi.allergens && ${avoidAllergensArray})
      )
    order by
      (
        (case when ${prefs.spiceLevel ?? null}::text is not null and mi.spice_level = ${prefs.spiceLevel ?? null} then 2 else 0 end) +
        (case when ${prefs.mood ?? null}::text is not null and ${prefs.mood ?? null} = any(mi.tags) then 2 else 0 end) +
        (case when rm.price_paise between ${budgetMin} and ${budgetMax} then 1 else 0 end)
      ) desc,
      coalesce(pop.qty_sold, 0) desc,
      mi.name
    limit ${limit}
  `);

  return result.rows.map((r) => ({
    menuItemId: r.menu_item_id,
    name: r.name,
    description: r.description,
    pricePaise: r.price_paise,
    tags: r.tags,
    spiceLevel: r.spice_level,
    matchedMood: prefs.mood !== undefined && r.tags.includes(prefs.mood),
    matchedSpice: prefs.spiceLevel !== undefined && r.spice_level === prefs.spiceLevel,
    matchedBudget: Number(r.price_paise) >= budgetMin && Number(r.price_paise) <= budgetMax,
    popularity: Number(r.popularity),
  }));
}

function getProvider(): AIProvider | null {
  // "Turn the AI provider off" (ADR-0007 §3's acceptance demo) means
  // exactly this: unset the key, every surface below still works.
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  // Swapped from openai/gpt-oss-20b:free (owner decision, 2026-07-24) —
  // real benchmarking found gpt-oss-20b spends its token budget on hidden
  // chain-of-thought before any visible content (10-24s observed,
  // needing 300+ maxTokens just to survive it), where gemma-4-26b-a4b-it
  // is a plain instruct model with no hidden reasoning: 3.7-7.6s observed
  // for this exact prompt shape, and correct JSON every time even at a
  // 100-token cap. See DECISIONS.md for the full benchmark.
  return new OpenRouterProvider({
    model: "google/gemma-4-26b-a4b-it:free",
    apiKey,
    costPer1kTokens: { input: 0, output: 0 },
    id: "google/gemma-4-26b-a4b-it:free",
  });
}

const REASON_SYSTEM_PROMPT =
  "You are a knowledgeable, warm dining host helping a guest discover dishes they'll genuinely love — " +
  "not an algorithm listing matches. Write one-line reasons under 12 words that build trust by being " +
  "specific about WHY (their stated mood, spice preference, or what's popular tonight), the way a " +
  "great waiter would explain a recommendation. Reply with ONLY a JSON object mapping each given dish " +
  "id to its reason string. No markdown, no code fences, no extra text — just the JSON object. Never " +
  "invent facts about a dish you weren't given.";

function buildReasonPrompt(candidates: RankedCandidate[], prefs: BoothHostPreferences): string {
  const guestContext = [
    prefs.mood && `mood: ${prefs.mood}`,
    prefs.spiceLevel && `spice: ${prefs.spiceLevel}`,
    prefs.diet && `diet: ${prefs.diet}`,
    prefs.freeText && `guest said: "${prefs.freeText}"`,
  ]
    .filter(Boolean)
    .join(", ");
  const dishLines = candidates
    .map((c) => `${c.menuItemId}: ${c.name}${c.description ? " — " + c.description : ""} (tags: ${c.tags.join(", ") || "none"}, spice: ${c.spiceLevel ?? "unspecified"})`)
    .join("\n");
  return `Guest preferences: ${guestContext || "none stated"}.\n\nDishes:\n${dishLines}\n\nWrite one short, specific reason per dish id as JSON.`;
}

export async function getBoothHostRecommendations(guest: { storeId: string; outletId: string }, prefs: BoothHostPreferences): Promise<BoothHostResult> {
  const candidates = await getRankedCandidates(guest.storeId, prefs, SHORTLIST_LIMIT);
  if (candidates.length === 0) return { items: [], aiUsed: false };

  const withFallback = (): BoothHostResult => ({
    items: candidates.map((c) => ({ menuItemId: c.menuItemId, name: c.name, pricePaise: c.pricePaise, reason: fallbackReason(c) })),
    aiUsed: false,
  });

  const provider = getProvider();
  if (!provider) return withFallback();

  const db = getDb();
  const budgetStatus = await db.transaction((tx) => checkBudget(tx, guest.outletId));
  if (!budgetStatus.allowed) return withFallback();

  const key = cacheKey("booth_host", [
    guest.storeId,
    prefs.mood ?? null,
    prefs.spiceLevel ?? null,
    prefs.diet ?? null,
    prefs.budgetBand ?? null,
    prefs.freeText ?? null,
    candidates.map((c) => c.menuItemId).join(","),
  ]);
  const cached = await db.transaction((tx) => getCached(tx, key));
  if (cached) {
    const reasons = JSON.parse(cached) as Record<string, string>;
    return { items: candidates.map((c) => ({ menuItemId: c.menuItemId, name: c.name, pricePaise: c.pricePaise, reason: reasons[c.menuItemId] ?? fallbackReason(c) })), aiUsed: true };
  }

  const prompt = buildReasonPrompt(candidates, prefs);
  // 400 tokens: real headroom above gemma's observed ~15 tokens/reason
  // (SHORTLIST_LIMIT=5 candidates), not gpt-oss-20b's old 2000 — that
  // budget existed only because gpt-oss-20b needed 300+ tokens of hidden
  // reasoning headroom BEFORE any visible content; gemma has none.
  const result = await withTimeout(provider.complete({ system: REASON_SYSTEM_PROMPT, prompt, maxTokens: 400, temperature: 0.4 }), BOOTH_TIMEOUT_MS);
  if (!result) return withFallback();

  const reasons = parseReasons(result.text, candidates);
  if (Object.keys(reasons).length === 0) return withFallback();

  const businessDate = new Date().toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    await recordUsage(tx, {
      outletId: guest.outletId,
      storeId: guest.storeId,
      businessDate,
      feature: "booth_host",
      providerId: provider.id,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costPaise: 0n,
    });
    await setCached(tx, key, "booth_host", JSON.stringify(reasons), CACHE_TTL_MS);
  });

  return {
    items: candidates.map((c) => ({ menuItemId: c.menuItemId, name: c.name, pricePaise: c.pricePaise, reason: reasons[c.menuItemId] ?? fallbackReason(c) })),
    aiUsed: true,
  };
}
