/**
 * Rupees ⇄ paise, as bigint — never a float (CLAUDE.md's standing money
 * rule). Pure, no React, no CSS: extracted from MoneyInput.tsx so the
 * money math is unit-testable on its own and isn't dragged through a
 * client-component/CSS-module import to exercise it. Money logic has no
 * business living inside a rendering component.
 */

/**
 * Parse a user-typed rupee string to paise. Returns null for anything that
 * isn't a clean amount of up to two decimal places.
 *
 * Deliberately REJECTS a third decimal place ("180.505") rather than
 * rounding it. This is direct price ENTRY, not a value COMPUTED from
 * others: the domain-wide half-up rounding rule (DOMAIN.md §5) applies to
 * derived amounts like tax, where fractional paise are unavoidable and
 * must be resolved deterministically. A human typing a price should get
 * exactly what they typed or a validation error — never a number the
 * system silently adjusted under them. (This is a refinement of the Phase
 * 2 plan's one-line "rounds half-up" note, made deliberately during
 * implementation; the reasoning is recorded here so it isn't re-litigated.)
 */
export function parseRupeesToPaise(input: string): bigint | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const rupees = BigInt(match[1]!);
  const paiseFraction = (match[2] ?? "").padEnd(2, "0");
  return rupees * 100n + BigInt(paiseFraction);
}

/** Format paise as a fixed 2-decimal rupee string (no currency symbol). */
export function formatPaiseAsRupees(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const cents = abs % 100n;
  return `${negative ? "-" : ""}${rupees}.${cents.toString().padStart(2, "0")}`;
}
