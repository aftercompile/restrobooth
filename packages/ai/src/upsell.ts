import { sql, type Database, type RlsTx } from "@restrobooth/db";
import type { AIProvider } from "./provider.js";
import { OpenRouterProvider } from "./openRouterProvider.js";
import { withTimeout } from "./timeout.js";
import { checkBudget, recordUsage } from "./budgetGuard.js";
import { cacheKey, getCached, setCached } from "./cache.js";
import { estimateCostPaise } from "./cost.js";

/**
 * Smart upsell — RESTROBOOTH_BRIEF.md §5E / ADR-0007's own worked example:
 * "Upsell → SQL market-basket lift, with a generic label ('Often ordered
 * together'). The numbers were never AI." Same governing split as the
 * Booth Host (Slice 2): the SHORTLIST (which item to suggest, and which
 * cart item it pairs with) is deterministic SQL; the LLM, when available,
 * only writes the one-line reason. Shared here (not app-local like
 * booth-host.ts) because this feature is explicitly two-surface — the
 * Booth cart AND Captain's order screen both need the identical numbers.
 *
 * "Measured: attach rate, AOV delta" (brief §5E) is NOT built here —
 * that needs its own impression/conversion log and a report to read it,
 * which is Phase 9 (Reports) territory once the rollup layer exists.
 * `ai_usage_ledger` (feature="upsell") gives a call-volume signal in the
 * meantime; it is not attach rate.
 */

export interface UpsellCandidate {
  menuItemId: string;
  name: string;
  pricePaise: string;
  /** The cart/order item this candidate pairs best with — the SQL
   *  shortlist's own anchor, not a guess. */
  pairedWithMenuItemId: string;
  pairedWithName: string;
  reason: string;
}

export interface UpsellResult {
  items: UpsellCandidate[];
  aiUsed: boolean;
}

// Same budget as the Booth Host (ADR-0007 §3), raised from 1200ms to
// 10000ms alongside it (owner decision, 2026-07-24 — see booth-host.ts's
// own comment for the real benchmark data this is based on: a 9000ms
// ceiling measured too tight live for Booth Host's own 5-candidate
// prompt, landing at 9116-9151ms twice in a row; set uniformly to the
// top of the owner's stated 8-10s range rather than leaving the two
// shared-code-path features at different budgets). Both callers
// (apps/booth's cart, apps/captain's order screen) now stream this
// section in via Suspense rather than blocking the whole page — see
// UpsellSection.tsx in each app.
const UPSELL_TIMEOUT_MS = 10000;
const SUGGESTION_LIMIT = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // Same menu_version gap as booth-host.ts's cache — see that file's comment.
const MIN_CO_OCCURRENCE = 2; // A single coincidental pairing isn't a pattern — matches the "real signal, not noise" bar the Booth Host's popularity scoring already applies.

export interface RankedCandidate {
  candidateId: string;
  candidateName: string;
  pricePaise: string;
  pairedWithId: string;
  pairedWithName: string;
  lift: number;
}

/**
 * Market-basket lift, computed entirely in SQL. For each item already in
 * the cart/order, finds co-occurring items from this store's real order
 * history (order_items sharing an order_id, voided lines excluded) and
 * scores every candidate by its single best pairing (`distinct on`) —
 * lift = P(both) / (P(cart item) * P(candidate)), the standard
 * market-basket-analysis definition. Never recommends an unavailable
 * (86'd) item — joined through resolve_menu(), same as the Booth Host.
 */
async function getRankedCandidates(db: Database | RlsTx, storeId: string, cartMenuItemIds: string[], limit: number): Promise<RankedCandidate[]> {
  if (cartMenuItemIds.length === 0) return [];

  // sql`${array}::uuid[]` does NOT bind a JS array as a single Postgres
  // array parameter — drizzle expands each element into its own scalar
  // placeholder, so `any($array::uuid[])` receives a bare (a,b,c) ROW
  // constructor and Postgres rejects the cast ("cannot cast type record
  // to uuid[]"). sql.join + an explicit array[...] constructor is the
  // established pattern this codebase already uses for IN-lists
  // (apps/captain's fireOrder, apps/kds's board queries) — same fix,
  // applied to ANY() instead of IN().
  const cartItemsArray = sql`array[${sql.join(
    cartMenuItemIds.map((id) => sql`${id}`),
    sql`, `,
  )}]::uuid[]`;

  const result = await db.execute<{
    [key: string]: unknown;
    candidate_id: string;
    candidate_name: string;
    price_paise: string;
    paired_with_id: string;
    paired_with_name: string;
    lift: string;
  }>(sql`
    with item_orders as (
      select oi.menu_item_id, oi.order_id
      from order_items oi
      where oi.store_id = ${storeId} and oi.status != 'voided'
    ),
    total_orders as (
      select count(distinct order_id)::float as n from item_orders
    ),
    support as (
      select menu_item_id, count(distinct order_id)::float as order_count
      from item_orders
      group by menu_item_id
    ),
    co_occurrence as (
      select a.menu_item_id as cart_item_id, b.menu_item_id as candidate_id, count(distinct a.order_id)::float as co_count
      from item_orders a
      join item_orders b on a.order_id = b.order_id and a.menu_item_id != b.menu_item_id
      where a.menu_item_id = any(${cartItemsArray})
        and not (b.menu_item_id = any(${cartItemsArray}))
      group by a.menu_item_id, b.menu_item_id
      having count(distinct a.order_id) >= ${MIN_CO_OCCURRENCE}
    ),
    scored as (
      select
        co.candidate_id, co.cart_item_id, co.co_count,
        (co.co_count / nullif((s_cart.order_count * s_cand.order_count / nullif(t.n, 0)), 0)) as lift
      from co_occurrence co
      join support s_cart on s_cart.menu_item_id = co.cart_item_id
      join support s_cand on s_cand.menu_item_id = co.candidate_id
      cross join total_orders t
    ),
    ranked as (
      select distinct on (candidate_id) candidate_id, cart_item_id, lift
      from scored
      order by candidate_id, lift desc
    )
    select
      r.candidate_id, mi_cand.name as candidate_name, rm.price_paise,
      r.cart_item_id as paired_with_id, mi_cart.name as paired_with_name,
      r.lift
    from ranked r
    join menu_items mi_cand on mi_cand.id = r.candidate_id
    join menu_items mi_cart on mi_cart.id = r.cart_item_id
    join resolve_menu(${storeId}, 'dinein') rm on rm.menu_item_id = r.candidate_id
    where rm.is_available
    order by r.lift desc
    limit ${limit}
  `);

  return result.rows.map((r) => ({
    candidateId: r.candidate_id,
    candidateName: r.candidate_name,
    pricePaise: r.price_paise,
    pairedWithId: r.paired_with_id,
    pairedWithName: r.paired_with_name,
    lift: Number(r.lift),
  }));
}

export function fallbackReason(c: RankedCandidate): string {
  return `Guests who ordered ${c.pairedWithName} loved this too`;
}

function getProvider(): AIProvider | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  // openai/gpt-oss-20b:free -> google/gemma-4-26b-a4b-it:free ->
  // openai/gpt-4o-mini (owner decision, 2026-07-24) — see
  // apps/booth/lib/booth-host.ts's own getProvider() comment for the
  // benchmark data this is based on and why it's a real, tracked cost
  // now rather than free.
  return new OpenRouterProvider({
    model: "openai/gpt-4o-mini",
    apiKey,
    costPer1kTokens: { input: 0.00015, output: 0.0006 },
    id: "openai/gpt-4o-mini",
  });
}

const REASON_SYSTEM_PROMPT =
  "You are a warm, knowledgeable host suggesting one thoughtful add-on per already-ordered dish — " +
  "hospitality, not a sales pitch. Reply with ONLY a JSON object mapping each given suggestion id to a " +
  "short reason under 10 words, written as if speaking to the guest (e.g. 'Perfect with your X', " +
  "'Our chef recommends this alongside your X'). No markdown, no code fences, no extra text — just the " +
  "JSON object. Never invent facts you weren't given.";

function buildReasonPrompt(candidates: RankedCandidate[]): string {
  const lines = candidates
    .map((c) => `${c.candidateId}: suggest "${c.candidateName}" as an add-on to their "${c.pairedWithName}"`)
    .join("\n");
  return `Write one short, natural upsell line per suggestion id as JSON:\n${lines}`;
}

export function parseReasons(text: string, candidates: RankedCandidate[]): Record<string, string> {
  try {
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return {};
    const parsed: unknown = JSON.parse(match[0]);
    if (typeof parsed !== "object" || parsed === null) return {};
    const known = new Set(candidates.map((c) => c.candidateId));
    const out: Record<string, string> = {};
    for (const [id, reason] of Object.entries(parsed as Record<string, unknown>)) {
      if (known.has(id) && typeof reason === "string" && reason.trim().length > 0) out[id] = reason.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** `db` accepts either a top-level `Database` (guest paths, apps/booth's
 *  cart / apps/captain's order screen) or an `RlsTx` (a staff Console
 *  action running under RLS, or a caller already inside its own
 *  transaction — see budgetExhaustion.test.ts). */
export async function getUpsellSuggestions(
  db: Database | RlsTx,
  target: { storeId: string; outletId: string; cartMenuItemIds: string[] },
): Promise<UpsellResult> {
  const candidates = await getRankedCandidates(db, target.storeId, target.cartMenuItemIds, SUGGESTION_LIMIT);
  if (candidates.length === 0) return { items: [], aiUsed: false };

  const toResult = (reasons: Record<string, string>, aiUsed: boolean): UpsellResult => ({
    items: candidates.map((c) => ({
      menuItemId: c.candidateId,
      name: c.candidateName,
      pricePaise: c.pricePaise,
      pairedWithMenuItemId: c.pairedWithId,
      pairedWithName: c.pairedWithName,
      reason: reasons[c.candidateId] ?? fallbackReason(c),
    })),
    aiUsed,
  });

  const provider = getProvider();
  if (!provider) return toResult({}, false);

  const budgetStatus = await db.transaction((tx) => checkBudget(tx, target.outletId));
  if (!budgetStatus.allowed) return toResult({}, false);

  const key = cacheKey("upsell", [target.storeId, ...target.cartMenuItemIds.slice().sort()]);
  const cached = await db.transaction((tx) => getCached(tx, key));
  if (cached) return toResult(JSON.parse(cached) as Record<string, string>, true);

  const prompt = buildReasonPrompt(candidates);
  // 500 tokens — matches booth-host.ts's own bump (real margin observed
  // live against gpt-4o-mini on the 5-candidate Booth Host prompt;
  // applied here too for consistency, this prompt has fewer candidates
  // so 500 is comfortable headroom, not a tight fit).
  const result = await withTimeout(provider.complete({ system: REASON_SYSTEM_PROMPT, prompt, maxTokens: 500, temperature: 0.4 }), UPSELL_TIMEOUT_MS);
  if (!result) return toResult({}, false);

  const reasons = parseReasons(result.text, candidates);
  if (Object.keys(reasons).length === 0) return toResult({}, false);

  const businessDate = new Date().toISOString().slice(0, 10);
  await db.transaction(async (tx) => {
    await recordUsage(tx, {
      outletId: target.outletId,
      storeId: target.storeId,
      businessDate,
      feature: "upsell",
      providerId: provider.id,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costPaise: estimateCostPaise(provider.costPer1kTokens, result.inputTokens, result.outputTokens),
    });
    await setCached(tx, key, "upsell", JSON.stringify(reasons), CACHE_TTL_MS);
  });

  return toResult(reasons, true);
}
