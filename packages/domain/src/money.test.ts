import { describe, expect, test } from "vitest";
import { allocateLargestRemainder, roundHalfUpDiv, roundPercentOf, roundTaxComponent, roundToRupee } from "./money";

describe("roundHalfUpDiv", () => {
  test("exact division needs no rounding", () => {
    expect(roundHalfUpDiv(100n, 4n)).toBe(25n);
  });

  test("below .5 rounds down", () => {
    expect(roundHalfUpDiv(24n, 100n)).toBe(0n); // 0.24 -> nearest int is 0
  });

  test("above .5 rounds up", () => {
    expect(roundHalfUpDiv(74n, 100n)).toBe(1n); // 0.74 -> nearest int is 1
  });

  test("exactly .5 rounds UP, never banker's rounding", () => {
    // DOMAIN.md §7.3: gross 84 550 -> round_to_rupee -> 84 600 ("half rounds up").
    // As a raw ratio: 845.5 must round to 846, not 844 or 845.
    expect(roundHalfUpDiv(8455n, 10n)).toBe(846n);
  });

  test("rejects a negative numerator or non-positive denominator", () => {
    expect(() => roundHalfUpDiv(-1n, 10n)).toThrow();
    expect(() => roundHalfUpDiv(1n, 0n)).toThrow();
    expect(() => roundHalfUpDiv(1n, -5n)).toThrow();
  });
});

describe("roundPercentOf", () => {
  test("15% of 85 500 is 12 825 (§7.2's line discount, exact)", () => {
    expect(roundPercentOf(85_500n, 1500)).toBe(12_825n);
  });

  test("10% of 100 000 is 10 000 (§7.3's service charge, exact)", () => {
    expect(roundPercentOf(100_000n, 1000)).toBe(10_000n);
  });

  test("rounds half-up like every other percentage in this package", () => {
    expect(roundPercentOf(101n, 5000)).toBe(51n); // 50.5 -> 51
  });

  test("rejects a negative rate", () => {
    expect(() => roundPercentOf(100n, -1)).toThrow();
  });
});

describe("roundTaxComponent — DOMAIN.md §7's worked rounding cases", () => {
  test("§7.2: 72 675 at 2.5% rounds 1 816.875 up to 1 817", () => {
    expect(roundTaxComponent(72_675n, 250)).toBe(1_817n);
  });

  test("§7.1: 76 000 at 2.5% (FOOD_5 CGST) is exact at 1 900", () => {
    expect(roundTaxComponent(76_000n, 250)).toBe(1_900n);
  });

  test("§7.1: 4 000 at 9% (GOODS_18 CGST) is exact at 360", () => {
    expect(roundTaxComponent(4_000n, 900)).toBe(360n);
  });

  test("§7.4 split example: S1 49 167 at 2.5% rounds 1 229.175 down to 1 229", () => {
    expect(roundTaxComponent(49_167n, 250)).toBe(1_229n);
  });

  test("§7.4 split example: S2 32 667 at 2.5% rounds 816.675 up to 817", () => {
    expect(roundTaxComponent(32_667n, 250)).toBe(817n);
  });

  test("component-wise never equals half of a combined-rate rounding — the whole point of the rule", () => {
    // DOMAIN.md §5 rule 3's own example: on a taxable of 100 paise, 5% = 5
    // paise combined, but 2.5%+2.5% computed independently is 3+3=6 paise.
    const cgst = roundTaxComponent(100n, 250);
    const sgst = roundTaxComponent(100n, 250);
    expect(cgst).toBe(3n);
    expect(sgst).toBe(3n);
    expect(cgst + sgst).toBe(6n); // NOT round(100 * 0.05) = 5
  });
});

describe("roundToRupee — DOMAIN.md §7's round-off cases", () => {
  test("§7.1: 84 520 rounds down to 84 500 (round_off = -20)", () => {
    expect(roundToRupee(84_520n)).toBe(84_500n);
  });

  test("§7.2: 76 309 rounds down to 76 300 (round_off = -9)", () => {
    expect(roundToRupee(76_309n)).toBe(76_300n);
  });

  test("§7.3: 115 500 is already whole (round_off = 0)", () => {
    expect(roundToRupee(115_500n)).toBe(115_500n);
  });

  test("§7.3: a round-UP case, 84 560 rounds up to 84 600 (round_off = +40)", () => {
    expect(roundToRupee(84_560n)).toBe(84_600n);
  });

  test("§7.3: exactly on the boundary, 84 550 rounds UP to 84 600 (round_off = +50)", () => {
    expect(roundToRupee(84_550n)).toBe(84_600n);
  });

  test("always returns a multiple of 100", () => {
    for (const paise of [0n, 1n, 50n, 99n, 100n, 149n, 150n, 151n, 999_999n]) {
      expect(roundToRupee(paise) % 100n).toBe(0n);
    }
  });

  test("rejects a negative amount", () => {
    expect(() => roundToRupee(-1n)).toThrow();
  });
});

describe("allocateLargestRemainder", () => {
  test("§7.4: a 62 000-paise shared pool splits three equal ways as 20 667 / 20 667 / 20 666", () => {
    // Equal weights -> equal shares, remainder ties broken by ascending index.
    const shares = allocateLargestRemainder(62_000n, [1n, 1n, 1n]);
    expect(shares).toEqual([20_667n, 20_667n, 20_666n]);
    expect(shares.reduce((a, b) => a + b, 0n)).toBe(62_000n);
  });

  test("exact division needs no remainder distribution", () => {
    expect(allocateLargestRemainder(300n, [1n, 1n, 1n])).toEqual([100n, 100n, 100n]);
  });

  test("weighted allocation is proportional", () => {
    // 100 split 1:3 -> exact would be 25/75.
    expect(allocateLargestRemainder(100n, [1n, 3n])).toEqual([25n, 75n]);
  });

  test("three distinct, non-tied remainders are ranked correctly, largest first", () => {
    // total=10, weights=[3,4,5] (totalWeight=12): base shares 2/3/4 (sum 9),
    // remainders 6/4/2 -- all different, so the largest-remainder tie-break
    // isn't exercising the index tie-break at all here, only genuine
    // largest-remainder ranking. The single deficit unit goes to weight 3
    // (remainder 6, the largest).
    expect(allocateLargestRemainder(10n, [3n, 4n, 5n])).toEqual([3n, 3n, 4n]);
  });

  test("a zero weight receives a zero share, never a divide-by-zero", () => {
    expect(allocateLargestRemainder(100n, [1n, 0n, 1n])).toEqual([50n, 0n, 50n]);
  });

  test("the sum always equals the total exactly, across many weight shapes", () => {
    const cases: bigint[][] = [
      [1n, 1n, 1n],
      [7n, 11n, 13n],
      [1n, 1n, 1n, 1n, 1n, 1n, 1n],
      [1_000_000n, 1n],
    ];
    for (const weights of cases) {
      const shares = allocateLargestRemainder(999_999n, weights);
      expect(shares.reduce((a, b) => a + b, 0n)).toBe(999_999n);
    }
  });

  test("total zero across zero weight returns all zeros, not an error", () => {
    expect(allocateLargestRemainder(0n, [0n, 0n])).toEqual([0n, 0n]);
  });

  test("a non-zero total across all-zero weight is a genuine error — nothing to allocate against", () => {
    expect(() => allocateLargestRemainder(100n, [0n, 0n])).toThrow();
  });

  test("rejects a negative total or a negative weight", () => {
    expect(() => allocateLargestRemainder(-1n, [1n])).toThrow();
    expect(() => allocateLargestRemainder(1n, [-1n, 2n])).toThrow();
  });

  test("an empty weight list with a zero total returns an empty list", () => {
    expect(allocateLargestRemainder(0n, [])).toEqual([]);
  });
});
