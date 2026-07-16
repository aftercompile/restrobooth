/**
 * The two rounding/allocation primitives every other money function in
 * this package is built from (DOMAIN.md §5). Kept separate from bill.ts
 * because both are reused well beyond bill computation — invoice-number
 * math and (later) inventory costing will want the same half-up rule, and
 * split-bill/discount-allocation both need the same largest-remainder
 * method. One implementation, tested once, is what keeps three rounding
 * call sites from silently drifting apart.
 */

/**
 * Rounds the rational number `numerator / denominator` to the nearest
 * integer, half rounding UP (never banker's rounding, never truncation).
 * Both arguments must be non-negative — money in this domain is never
 * negative at the point it's rounded; a negative result (e.g. round_off)
 * is always a subtraction of two already-rounded non-negative values, not
 * something this function is asked to round directly.
 *
 * Uses the exact-integer form `floor((2n + d) / (2d))` rather than
 * floating-point division specifically to avoid the case this whole
 * package exists to prevent: a paisa silently computed wrong.
 */
export function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("roundHalfUpDiv: denominator must be positive");
  if (numerator < 0n) throw new Error("roundHalfUpDiv: numerator must be non-negative");
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * `rateBps` percent of `basePaise`, rounded half-up. `rateBps` is basis
 * points (100 = 1%). The one primitive behind both a tax component's
 * amount and a percent-of-subtotal bill discount — they're the same
 * arithmetic, just applied to different things, so there's one rounding
 * implementation instead of two that could quietly disagree.
 */
export function roundPercentOf(basePaise: bigint, rateBps: number): bigint {
  if (rateBps < 0) throw new Error("roundPercentOf: rateBps must be non-negative");
  return roundHalfUpDiv(basePaise * BigInt(rateBps), 10_000n);
}

/**
 * DOMAIN.md §5 rule 3: a tax component (CGST, SGST, IGST) is computed at
 * its OWN rate and rounded independently — never by computing the
 * combined rate and splitting the rounded result. `rateBps` matches
 * `tax_classes.rate_bps` in the schema.
 */
export function roundTaxComponent(taxablePaise: bigint, rateBps: number): bigint {
  return roundPercentOf(taxablePaise, rateBps);
}

/**
 * DOMAIN.md §5 rule 4: the bill TOTAL rounds to the nearest whole rupee,
 * half up. Returns the rounded amount in paise (always a multiple of 100).
 */
export function roundToRupee(amountPaise: bigint): bigint {
  if (amountPaise < 0n) throw new Error("roundToRupee: amountPaise must be non-negative");
  return roundHalfUpDiv(amountPaise, 100n) * 100n;
}

/**
 * The largest-remainder method: divides `total` across `weights`
 * proportionally, as whole units, guaranteeing `Σ result === total`
 * exactly — no paisa created or destroyed, and no fractional unit ever
 * appears. This is the ONE allocator behind three separate DOMAIN.md
 * rules: a bill-level discount allocated back to lines pro-rata by line
 * taxable value (§5.8), a shared order-item's cost split across guests
 * (§7.4), and a split-by-amount share of a bill's payable (§7.4).
 *
 * Ties in remainder are broken by ascending input index, so the result is
 * deterministic and reproducible from the same input every time — DOMAIN.md
 * §7.4's split-by-guest example depends on exactly this tie-break order
 * ("S1: 20 667, S2: 20 667, S3: 20 666").
 *
 * `total` and every weight must be non-negative; a zero total weight is
 * only valid when `total` is also zero (nothing to allocate against).
 */
export function allocateLargestRemainder(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) throw new Error("allocateLargestRemainder: total must be non-negative");
  const totalWeight = weights.reduce((sum, w) => {
    if (w < 0n) throw new Error("allocateLargestRemainder: weights must be non-negative");
    return sum + w;
  }, 0n);

  if (totalWeight === 0n) {
    if (total !== 0n) {
      throw new Error("allocateLargestRemainder: cannot allocate a non-zero total across zero total weight");
    }
    return weights.map(() => 0n);
  }

  const shares: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0n;

  for (let i = 0; i < weights.length; i++) {
    const numerator = total * weights[i]!;
    const base = numerator / totalWeight; // floor division — both operands non-negative
    shares.push(base);
    allocated += base;
    remainders.push({ index: i, remainder: numerator % totalWeight });
  }

  let deficit = total - allocated;
  remainders.sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return b.remainder > a.remainder ? 1 : -1;
  });

  for (let i = 0; i < remainders.length && deficit > 0n; i++) {
    shares[remainders[i]!.index]! += 1n;
    deficit -= 1n;
  }

  return shares;
}
