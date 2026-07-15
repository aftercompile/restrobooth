import { describe, expect, test } from "vitest";
import { formatPaiseAsRupees, parseRupeesToPaise } from "./money";

// Money is the thing that must never be wrong (CLAUDE.md). Price ENTRY has
// its own rule, distinct from computed values: it rejects anything it
// can't represent exactly, rather than silently adjusting what a human
// typed. These tests pin that behaviour.
describe("parseRupeesToPaise", () => {
  test("whole rupees → paise", () => {
    expect(parseRupeesToPaise("180")).toBe(18000n);
    expect(parseRupeesToPaise("0")).toBe(0n);
  });

  test("one and two decimal places", () => {
    expect(parseRupeesToPaise("180.5")).toBe(18050n); // .5 is 50 paise, not 5
    expect(parseRupeesToPaise("180.05")).toBe(18005n);
    expect(parseRupeesToPaise("180.50")).toBe(18050n);
    expect(parseRupeesToPaise("0.99")).toBe(99n);
  });

  test("surrounding whitespace is tolerated", () => {
    expect(parseRupeesToPaise("  42.50  ")).toBe(4250n);
  });

  test("REJECTS a third decimal place — never silently rounds price entry", () => {
    // The whole point: a human typing 180.505 gets a validation error, not
    // a number the system quietly changed to 180.50 or 180.51.
    expect(parseRupeesToPaise("180.505")).toBeNull();
    expect(parseRupeesToPaise("0.001")).toBeNull();
  });

  test("rejects non-numeric, negative, and empty input", () => {
    expect(parseRupeesToPaise("")).toBeNull();
    expect(parseRupeesToPaise("   ")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise("-5")).toBeNull(); // a price is never negative
    expect(parseRupeesToPaise("₹180")).toBeNull();
    expect(parseRupeesToPaise("1,800")).toBeNull();
    expect(parseRupeesToPaise("1.2.3")).toBeNull();
    expect(parseRupeesToPaise(".5")).toBeNull(); // must have a whole part
  });

  test("no floating-point error at large amounts (bigint, not float)", () => {
    // 0.1 + 0.2 !== 0.3 in float; this must be exact.
    expect(parseRupeesToPaise("99999999.99")).toBe(9999999999n);
  });
});

describe("formatPaiseAsRupees", () => {
  test("always two decimal places", () => {
    expect(formatPaiseAsRupees(18000n)).toBe("180.00");
    expect(formatPaiseAsRupees(18050n)).toBe("180.50");
    expect(formatPaiseAsRupees(5n)).toBe("0.05");
    expect(formatPaiseAsRupees(0n)).toBe("0.00");
  });

  test("round-trips with parseRupeesToPaise", () => {
    for (const paise of [0n, 5n, 99n, 18000n, 18050n, 9999999999n]) {
      expect(parseRupeesToPaise(formatPaiseAsRupees(paise))).toBe(paise);
    }
  });
});
