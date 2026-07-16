import { describe, expect, test } from "vitest";
import { splitByAmount, splitByShares, type SplitLineInput } from "./splitBill";
import { computeBill } from "./bill";

const FOOD_5 = "FOOD_5";
const taxRates = [{ taxClassId: FOOD_5, rateBps: 500 }];

describe("splitByShares — DOMAIN.md §7.4's worked split-by-guest example", () => {
  // Table of 3 (S1, S2, S3), all FOOD_5, Ahmedabad.
  const lines: SplitLineInput[] = [
    { id: "butter-chicken", grossPaise: 38_000n, taxClassId: FOOD_5, sharedBy: ["S1", "S2", "S3"] },
    { id: "paneer-tikka", grossPaise: 28_500n, taxClassId: FOOD_5, sharedBy: ["S1"] },
    { id: "naan", grossPaise: 24_000n, taxClassId: FOOD_5, sharedBy: ["S1", "S2", "S3"] },
    { id: "coke", grossPaise: 24_000n, taxClassId: FOOD_5, sharedBy: ["S2", "S3"] },
  ];

  test("produces exactly the three bills the worked example specifies", () => {
    const shares = splitByShares(lines, taxRates, true);
    expect(shares).toHaveLength(3);

    const s1 = shares.find((s) => s.shareId === "S1")!;
    const s2 = shares.find((s) => s.shareId === "S2")!;
    const s3 = shares.find((s) => s.shareId === "S3")!;

    expect(s1.bill.subtotalPaise).toBe(49_167n);
    expect(s2.bill.subtotalPaise).toBe(32_667n);
    expect(s3.bill.subtotalPaise).toBe(32_666n);

    // Σ taxable == order subtotal, exactly — the invariant DOMAIN.md §7.4
    // says DOES hold, even though payable totals across splits need not.
    const orderSubtotal = lines.reduce((sum, l) => sum + l.grossPaise, 0n);
    expect(s1.bill.subtotalPaise + s2.bill.subtotalPaise + s3.bill.subtotalPaise).toBe(orderSubtotal);

    expect(s1.bill.payablePaise).toBe(51_600n);
    expect(s2.bill.payablePaise).toBe(34_300n);
    expect(s3.bill.payablePaise).toBe(34_300n);
    expect(s1.bill.roundOffPaise).toBe(-25n);
    expect(s2.bill.roundOffPaise).toBe(-1n);
    expect(s3.bill.roundOffPaise).toBe(0n);

    // The doc's own point: this sums to 120 200 here, but that's not
    // asserted as a general rule — see the test below.
    const totalPayable = s1.bill.payablePaise + s2.bill.payablePaise + s3.bill.payablePaise;
    expect(totalPayable).toBe(120_200n);
  });

  test("the un-split bill's total is NOT asserted to match — three independent documents, not a decomposition", () => {
    const unsplit = computeBill({
      lines: lines.map((l) => ({ id: l.id, grossPaise: l.grossPaise, taxClassId: l.taxClassId })),
      taxRates,
      isIntraState: true,
    });
    // DOMAIN.md §7.4: "For reference... payable 120 200. It happens to
    // match here. It is not guaranteed to, and the code must not assert
    // that it does." This test pins that it's a coincidence, not a rule:
    // it happens to equal the split sum for THIS input, but computeBill
    // and splitByShares are genuinely independent code paths with no
    // shared rounding step between them.
    expect(unsplit.payablePaise).toBe(120_200n);
  });

  test("a solo (non-shared) item is a plain split-by-item assignment — full amount, no allocation loss", () => {
    const shares = splitByShares(
      [{ id: "a", grossPaise: 1_000n, taxClassId: FOOD_5, sharedBy: ["only-guest"] }],
      taxRates,
      true,
    );
    expect(shares).toHaveLength(1);
    expect(shares[0]!.bill.subtotalPaise).toBe(1_000n);
  });

  test("rejects a line with no assigned share", () => {
    expect(() =>
      splitByShares([{ id: "a", grossPaise: 100n, taxClassId: FOOD_5, sharedBy: [] }], taxRates, true),
    ).toThrow();
  });

  test("rejects an invalid line discount", () => {
    expect(() =>
      splitByShares(
        [{ id: "a", grossPaise: 100n, lineDiscountPaise: 200n, taxClassId: FOOD_5, sharedBy: ["S1"] }],
        taxRates,
        true,
      ),
    ).toThrow();
  });

  test("shares with the same sharer-set and tax class pool together before allocating, not line-by-line", () => {
    // Two items shared identically among the same two guests: the pooled
    // amount (300) splits evenly, even though 100 and 200 individually
    // would NOT split evenly by 2 the same way if allocated separately
    // (100/2=50/50 exact; 200/2=100/100 exact) — use amounts where the
    // difference actually shows: 101 + 199 = 300 pooled (150/150 exact),
    // vs 101 split alone (51/50) + 199 split alone (100/99) = (151/149).
    const lines2: SplitLineInput[] = [
      { id: "a", grossPaise: 101n, taxClassId: FOOD_5, sharedBy: ["X", "Y"] },
      { id: "b", grossPaise: 199n, taxClassId: FOOD_5, sharedBy: ["X", "Y"] },
    ];
    const shares = splitByShares(lines2, taxRates, true);
    const x = shares.find((s) => s.shareId === "X")!;
    const y = shares.find((s) => s.shareId === "Y")!;
    expect(x.bill.subtotalPaise).toBe(150n);
    expect(y.bill.subtotalPaise).toBe(150n);
  });
});

describe("splitByAmount", () => {
  const bill = computeBill({
    lines: [{ id: "a", grossPaise: 100_000n, taxClassId: FOOD_5 }],
    taxRates,
    isIntraState: true,
  });

  test("an equal three-way split allocates every figure proportionally and sums back exactly", () => {
    const shares = splitByAmount(bill, [
      { shareId: "A", weight: 1n },
      { shareId: "B", weight: 1n },
      { shareId: "C", weight: 1n },
    ]);
    expect(shares).toHaveLength(3);

    const sumPayable = shares.reduce((s, sh) => s + sh.payablePaise, 0n);
    expect(sumPayable).toBe(bill.payablePaise);

    const sumSubtotal = shares.reduce((s, sh) => s + sh.subtotalPaise, 0n);
    expect(sumSubtotal).toBe(bill.subtotalPaise);

    for (const share of shares) {
      const sumTax = share.taxLines.reduce((s, t) => s + t.amountPaise, 0n);
      expect(sumTax).toBe(share.taxTotalPaise);
    }
  });

  test("an unequal split (60/40) is proportional, not equal", () => {
    const shares = splitByAmount(bill, [
      { shareId: "big", weight: 3n },
      { shareId: "small", weight: 2n },
    ]);
    const big = shares.find((s) => s.shareId === "big")!;
    const small = shares.find((s) => s.shareId === "small")!;
    expect(big.payablePaise).toBeGreaterThan(small.payablePaise);
    expect(big.payablePaise + small.payablePaise).toBe(bill.payablePaise);
  });

  test("every tax line's amounts sum exactly back to the original bill's tax line", () => {
    const shares = splitByAmount(bill, [
      { shareId: "A", weight: 1n },
      { shareId: "B", weight: 1n },
    ]);
    for (const original of bill.taxLines) {
      const sum = shares.reduce((s, share) => {
        const match = share.taxLines.find((t) => t.component === original.component && t.taxClassId === original.taxClassId);
        return s + (match?.amountPaise ?? 0n);
      }, 0n);
      expect(sum).toBe(original.amountPaise);
    }
  });

  test("rejects an empty share list", () => {
    expect(() => splitByAmount(bill, [])).toThrow();
  });
});
