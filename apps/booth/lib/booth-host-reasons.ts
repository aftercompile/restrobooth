/**
 * The Booth Host's pure, DB-free reasoning logic — split out of
 * booth-host.ts specifically so it's importable from a plain test/eval
 * file. booth-host.ts itself starts with `import "server-only"`, which
 * throws unconditionally outside Next's server-component module
 * resolution (including a plain vitest run) — this file has no such
 * guard and no side effects, matching packages/ai's upsell.ts (which
 * never needed one, since packages/ai isn't itself server-only).
 */

export interface RankedCandidate {
  menuItemId: string;
  name: string;
  description: string | null;
  pricePaise: string;
  tags: string[];
  spiceLevel: string | null;
  matchedMood: boolean;
  matchedSpice: boolean;
  matchedBudget: boolean;
  popularity: number;
}

/** No AI needed at all — real signals from the SQL scoring itself, still
 *  useful on its own (ADR-0007 §3: "still useful" is the bar for every
 *  fallback, not just "not broken"). */
export function fallbackReason(c: RankedCandidate): string {
  if (c.matchedSpice && c.matchedMood) return "Matches your spice and mood picks";
  if (c.matchedMood) return "Fits what you're in the mood for";
  if (c.matchedSpice) return "Right at your spice level";
  if (c.matchedBudget && c.popularity > 0) return "Popular with guests, and in your budget";
  if (c.popularity > 0) return "Popular with similar guests";
  if (c.matchedBudget) return "Fits your budget";
  return "Worth trying";
}

export function parseReasons(text: string, candidates: RankedCandidate[]): Record<string, string> {
  try {
    // Models occasionally wrap JSON in prose or fences despite instructions — extract the first {...} block.
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return {};
    const parsed: unknown = JSON.parse(match[0]);
    if (typeof parsed !== "object" || parsed === null) return {};
    const known = new Set(candidates.map((c) => c.menuItemId));
    const out: Record<string, string> = {};
    for (const [id, reason] of Object.entries(parsed as Record<string, unknown>)) {
      if (known.has(id) && typeof reason === "string" && reason.trim().length > 0) out[id] = reason.trim();
    }
    return out;
  } catch {
    return {};
  }
}
