import { describe, expect, test } from "vitest";
import { computeBill } from "./bill";

const FOOD_5 = "FOOD_5";
const GOODS_18 = "GOODS_18";

describe("computeBill — §7.1: two tax classes on one bill (Ahmedabad, intra-state)", () => {
  test("matches the worked example exactly", () => {
    const result = computeBill({
      lines: [
        { id: "butter-chicken", grossPaise: 76_000n, taxClassId: FOOD_5 },
        { id: "water", grossPaise: 4_000n, taxClassId: GOODS_18 },
      ],
      taxRates: [
        { taxClassId: FOOD_5, rateBps: 500 },
        { taxClassId: GOODS_18, rateBps: 1800 },
      ],
      isIntraState: true,
    });

    expect(result.subtotalPaise).toBe(80_000n);
    expect(result.billDiscountPaise).toBe(0n);

    const food = result.taxLines.filter((t) => t.taxClassId === FOOD_5);
    expect(food.find((t) => t.component === "cgst")?.amountPaise).toBe(1_900n);
    expect(food.find((t) => t.component === "sgst")?.amountPaise).toBe(1_900n);

    const goods = result.taxLines.filter((t) => t.taxClassId === GOODS_18);
    expect(goods.find((t) => t.component === "cgst")?.amountPaise).toBe(360n);
    expect(goods.find((t) => t.component === "sgst")?.amountPaise).toBe(360n);

    expect(result.taxTotalPaise).toBe(4_520n);
    expect(result.grossPaise).toBe(84_520n);
    expect(result.roundOffPaise).toBe(-20n);
    expect(result.payablePaise).toBe(84_500n);
    expect(result.payablePaise % 100n).toBe(0n); // the invariant the schema also enforces
  });
});

describe("computeBill — §7.2: item-level discount (component rounding)", () => {
  test("matches the worked example exactly, including the rounding note", () => {
    // Paneer Tikka x3 @ 28 500 = 85 500 gross, 15% line discount = 12 825.
    const result = computeBill({
      lines: [{ id: "paneer-tikka", grossPaise: 85_500n, lineDiscountPaise: 12_825n, taxClassId: FOOD_5 }],
      taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
      isIntraState: true,
    });

    expect(result.lines[0]!.taxablePaise).toBe(72_675n);
    expect(result.subtotalPaise).toBe(72_675n);

    const cgst = result.taxLines.find((t) => t.component === "cgst")!;
    const sgst = result.taxLines.find((t) => t.component === "sgst")!;
    // DOMAIN.md's own note: 1 817 + 1 817 = 3 634, which happens to equal
    // round(72 675 x 0.05) here — they don't always agree (see the money.test.ts
    // "component-wise never equals half of a combined-rate rounding" case).
    expect(cgst.amountPaise).toBe(1_817n);
    expect(sgst.amountPaise).toBe(1_817n);
    expect(result.taxTotalPaise).toBe(3_634n);

    expect(result.grossPaise).toBe(76_309n);
    expect(result.roundOffPaise).toBe(-9n);
    expect(result.payablePaise).toBe(76_300n);
  });
});

describe("computeBill — §7.3: service charge (taxed) and a round-UP case", () => {
  test("matches the worked example exactly", () => {
    const result = computeBill({
      lines: [{ id: "food", grossPaise: 100_000n, taxClassId: FOOD_5 }],
      taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
      charges: [{ name: "service_charge", taxClassId: FOOD_5, amountPaise: 10_000n }],
      isIntraState: true,
    });

    expect(result.chargesPaise).toBe(10_000n);
    // service charge IS part of the taxable value for its class.
    const cgst = result.taxLines.find((t) => t.component === "cgst")!;
    const sgst = result.taxLines.find((t) => t.component === "sgst")!;
    expect(cgst.taxablePaise).toBe(110_000n);
    expect(cgst.amountPaise).toBe(2_750n);
    expect(sgst.amountPaise).toBe(2_750n);

    expect(result.taxTotalPaise).toBe(5_500n);
    expect(result.grossPaise).toBe(115_500n);
    expect(result.roundOffPaise).toBe(0n); // already whole
    expect(result.payablePaise).toBe(115_500n);
  });

  test("a round-UP case at the exact half-rupee boundary", () => {
    // A zero-rate line puts gross exactly at 84 550 paise with no tax
    // arithmetic in the way — this test is purely about round_to_rupee's
    // boundary behaviour (already unit-tested in money.test.ts), pinned
    // here too so a future change to computeBill's rounding call site is
    // caught at the bill level, not just the primitive level.
    const result = computeBill({
      lines: [{ id: "x", grossPaise: 84_550n, taxClassId: "ZERO_RATE" }],
      taxRates: [{ taxClassId: "ZERO_RATE", rateBps: 0 }],
      isIntraState: true,
    });
    expect(result.grossPaise).toBe(84_550n);
    expect(result.roundOffPaise).toBe(50n); // half rounds UP, never down
    expect(result.payablePaise).toBe(84_600n);
  });

  test("a charge on a tax class no line item uses still creates that class's tax line", () => {
    // e.g. a packaging charge at GOODS_18 on a bill whose only food line is
    // FOOD_5 — the class has to start from zero taxable, not inherit
    // anything from a line that happens to share the class.
    const result = computeBill({
      lines: [{ id: "food", grossPaise: 100_000n, taxClassId: FOOD_5 }],
      taxRates: [
        { taxClassId: FOOD_5, rateBps: 500 },
        { taxClassId: GOODS_18, rateBps: 1800 },
      ],
      charges: [{ name: "packaging", taxClassId: GOODS_18, amountPaise: 2_000n }],
      isIntraState: true,
    });
    const goodsCgst = result.taxLines.find((t) => t.taxClassId === GOODS_18 && t.component === "cgst")!;
    expect(goodsCgst.taxablePaise).toBe(2_000n);
    expect(goodsCgst.amountPaise).toBe(180n);
  });
});

describe("computeBill — inter-state (IGST)", () => {
  test("uses IGST at the full rate instead of splitting into CGST+SGST", () => {
    const result = computeBill({
      lines: [{ id: "x", grossPaise: 76_000n, taxClassId: FOOD_5 }],
      taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
      isIntraState: false,
    });
    expect(result.taxLines).toHaveLength(1);
    expect(result.taxLines[0]!.component).toBe("igst");
    expect(result.taxLines[0]!.rateBps).toBe(500);
    expect(result.taxLines[0]!.amountPaise).toBe(1_900n + 1_900n); // == CGST+SGST would have been
  });
});

describe("computeBill — bill-level discount, flat and percent", () => {
  test("a flat bill discount is allocated back to lines pro-rata by taxable value", () => {
    const result = computeBill({
      lines: [
        { id: "a", grossPaise: 60_000n, taxClassId: FOOD_5 },
        { id: "b", grossPaise: 40_000n, taxClassId: FOOD_5 },
      ],
      taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
      billDiscount: { kind: "flat", amountPaise: 10_000n },
      isIntraState: true,
    });
    // 100 000 subtotal, 60/40 split -> discount allocated 6 000 / 4 000.
    expect(result.lines[0]!.allocatedBillDiscountPaise).toBe(6_000n);
    expect(result.lines[1]!.allocatedBillDiscountPaise).toBe(4_000n);
    expect(result.lines[0]!.taxablePaise).toBe(54_000n);
    expect(result.lines[1]!.taxablePaise).toBe(36_000n);
    expect(result.billDiscountPaise).toBe(10_000n);
    // The allocation always sums exactly back to the discount — no paisa lost.
    const sumAllocated = result.lines.reduce((s, l) => s + l.allocatedBillDiscountPaise, 0n);
    expect(sumAllocated).toBe(10_000n);
  });

  test("a percent bill discount computes its amount from the subtotal, half-up", () => {
    const result = computeBill({
      lines: [{ id: "a", grossPaise: 100_000n, taxClassId: FOOD_5 }],
      taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
      billDiscount: { kind: "percent", bps: 1500 }, // 15%
      isIntraState: true,
    });
    expect(result.billDiscountPaise).toBe(15_000n);
    expect(result.lines[0]!.taxablePaise).toBe(85_000n);
  });

  test("rejects a bill discount larger than the subtotal", () => {
    expect(() =>
      computeBill({
        lines: [{ id: "a", grossPaise: 1_000n, taxClassId: FOOD_5 }],
        taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
        billDiscount: { kind: "flat", amountPaise: 2_000n },
        isIntraState: true,
      }),
    ).toThrow();
  });

  test("rejects a negative flat bill discount", () => {
    expect(() =>
      computeBill({
        lines: [{ id: "a", grossPaise: 1_000n, taxClassId: FOOD_5 }],
        taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
        billDiscount: { kind: "flat", amountPaise: -1n },
        isIntraState: true,
      }),
    ).toThrow();
  });
});

describe("computeBill — input validation", () => {
  test("rejects a line discount larger than the line's gross", () => {
    expect(() =>
      computeBill({
        lines: [{ id: "a", grossPaise: 100n, lineDiscountPaise: 200n, taxClassId: FOOD_5 }],
        taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
        isIntraState: true,
      }),
    ).toThrow();
  });

  test("rejects a negative line discount", () => {
    expect(() =>
      computeBill({
        lines: [{ id: "a", grossPaise: 100n, lineDiscountPaise: -1n, taxClassId: FOOD_5 }],
        taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
        isIntraState: true,
      }),
    ).toThrow();
  });

  test("rejects a negative charge amount", () => {
    expect(() =>
      computeBill({
        lines: [{ id: "a", grossPaise: 100n, taxClassId: FOOD_5 }],
        taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
        charges: [{ name: "bad", taxClassId: FOOD_5, amountPaise: -1n }],
        isIntraState: true,
      }),
    ).toThrow();
  });

  test("rejects a line whose tax class has no rate provided", () => {
    expect(() =>
      computeBill({
        lines: [{ id: "a", grossPaise: 100n, taxClassId: "UNKNOWN" }],
        taxRates: [{ taxClassId: FOOD_5, rateBps: 500 }],
        isIntraState: true,
      }),
    ).toThrow();
  });

  test("rejects an intra-state rate that cannot split evenly into CGST+SGST", () => {
    expect(() =>
      computeBill({
        lines: [{ id: "a", grossPaise: 100n, taxClassId: "ODD" }],
        taxRates: [{ taxClassId: "ODD", rateBps: 501 }],
        isIntraState: true,
      }),
    ).toThrow();
  });

  test("an empty bill computes to zero, not an error", () => {
    const result = computeBill({ lines: [], taxRates: [], isIntraState: true });
    expect(result.subtotalPaise).toBe(0n);
    expect(result.payablePaise).toBe(0n);
  });
});
