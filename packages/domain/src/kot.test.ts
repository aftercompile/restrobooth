import { describe, expect, test } from "vitest";
import {
  assertKotTransition,
  canTransitionKot,
  groupByKitchenSection,
  type KitchenSection,
  type KotStatus,
} from "./kot";

// Restated independently from DOMAIN.md §3.3's diagram.
const LEGAL: ReadonlyArray<[KotStatus, KotStatus]> = [
  ["queued", "printed"],
  ["queued", "print_failed"],
  ["queued", "voided"],
  ["printed", "acknowledged"],
  ["printed", "preparing"], // KDS optional
  ["printed", "voided"],
  ["print_failed", "queued"], // retry
  ["acknowledged", "preparing"],
  ["acknowledged", "voided"],
  ["preparing", "ready"],
  ["preparing", "voided"],
  ["ready", "bumped"],
  ["ready", "voided"],
  ["bumped", "ready"], // recall
];

const ALL: KotStatus[] = [
  "queued",
  "printed",
  "print_failed",
  "acknowledged",
  "preparing",
  "ready",
  "bumped",
  "voided",
];

describe("kot transitions (DOMAIN.md §3.3)", () => {
  test("every documented transition is legal", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransitionKot(from, to)).toBe(true);
    }
  });

  test("every undocumented transition is illegal", () => {
    const legalSet = new Set(LEGAL.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL) {
      for (const to of ALL) {
        if (legalSet.has(`${from}->${to}`)) continue;
        expect(canTransitionKot(from, to)).toBe(false);
      }
    }
  });

  test("voided is terminal", () => {
    for (const to of ALL) {
      expect(canTransitionKot("voided", to)).toBe(false);
    }
  });

  test("assertKotTransition throws on illegal, silent on legal", () => {
    expect(() => assertKotTransition("bumped", "queued")).toThrow(/illegal kot transition/);
    expect(() => assertKotTransition("queued", "printed")).not.toThrow();
  });
});

describe("groupByKitchenSection — one fire, one KOT per line touched (DOMAIN.md §3.3)", () => {
  interface TestItem {
    id: string;
    kitchenSection: KitchenSection;
  }
  const item = (id: string, kitchenSection: KitchenSection): TestItem => ({ id, kitchenSection });

  test("a single-section order produces one group", () => {
    const groups = groupByKitchenSection([item("a", "hot"), item("b", "hot")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.section).toBe("hot");
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  test("curry (hot) + ice cream (cold) fires as two KOTs", () => {
    const groups = groupByKitchenSection([item("curry", "hot"), item("icecream", "cold")]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.section)).toEqual(["hot", "cold"]);
  });

  test("groups come back in canonical section order regardless of input order", () => {
    // bar item first, then cold, then hot — must still emit hot, cold, bar.
    const groups = groupByKitchenSection([item("beer", "bar"), item("kulfi", "cold"), item("dal", "hot")]);
    expect(groups.map((g) => g.section)).toEqual(["hot", "cold", "bar"]);
  });

  test("empty sections are omitted", () => {
    const groups = groupByKitchenSection([item("a", "hot"), item("b", "bar")]);
    expect(groups.map((g) => g.section)).toEqual(["hot", "bar"]);
  });

  test("an empty order produces no groups", () => {
    expect(groupByKitchenSection([])).toEqual([]);
  });

  test("items within a group preserve their input order", () => {
    const groups = groupByKitchenSection([item("a", "hot"), item("b", "cold"), item("c", "hot")]);
    const hot = groups.find((g) => g.section === "hot")!;
    expect(hot.items.map((i) => i.id)).toEqual(["a", "c"]);
  });
});
