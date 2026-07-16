import { describe, expect, test } from "vitest";
import {
  assertCanMerge,
  assertSessionTransition,
  canMerge,
  canTransitionSession,
  isTerminalSessionStatus,
  type TableSessionStatus,
} from "./tableSession";

// The legal transitions, restated independently from DOMAIN.md §3.1's
// diagram (NOT imported from the module — a test that reads the same table
// it checks proves nothing). Every pair not listed here must be illegal.
const LEGAL: ReadonlyArray<[TableSessionStatus, TableSessionStatus]> = [
  ["open", "ordering"],
  ["open", "abandoned"],
  ["open", "merged_into"],
  ["ordering", "dining"],
  ["ordering", "abandoned"],
  ["ordering", "merged_into"],
  ["dining", "bill_requested"],
  ["dining", "abandoned"],
  ["dining", "merged_into"],
  ["bill_requested", "settling"],
  ["bill_requested", "dining"], // the un-freeze
  ["bill_requested", "abandoned"],
  ["settling", "closed"],
  ["settling", "abandoned"],
];

const ALL: TableSessionStatus[] = [
  "open",
  "ordering",
  "dining",
  "bill_requested",
  "settling",
  "closed",
  "abandoned",
  "merged_into",
];

describe("table_session transitions (DOMAIN.md §3.1)", () => {
  test("every documented transition is legal", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransitionSession(from, to)).toBe(true);
    }
  });

  test("every undocumented transition is illegal", () => {
    const legalSet = new Set(LEGAL.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL) {
      for (const to of ALL) {
        if (legalSet.has(`${from}->${to}`)) continue;
        expect(canTransitionSession(from, to)).toBe(false);
      }
    }
  });

  test("closed, abandoned and merged_into are terminal", () => {
    expect(isTerminalSessionStatus("closed")).toBe(true);
    expect(isTerminalSessionStatus("abandoned")).toBe(true);
    expect(isTerminalSessionStatus("merged_into")).toBe(true);
    expect(isTerminalSessionStatus("open")).toBe(false);
    expect(isTerminalSessionStatus("dining")).toBe(false);
  });

  test("assertSessionTransition throws on an illegal move, is silent on a legal one", () => {
    expect(() => assertSessionTransition("closed", "open")).toThrow(/illegal table_session transition: closed -> open/);
    expect(() => assertSessionTransition("open", "ordering")).not.toThrow();
  });
});

describe("canMerge — the cross-store guard (DOMAIN.md §3.1)", () => {
  const A = { storeId: "store-a", status: "dining" as TableSessionStatus };
  const B_sameStore = { storeId: "store-a", status: "ordering" as TableSessionStatus };
  const B_otherStore = { storeId: "store-b", status: "ordering" as TableSessionStatus };

  test("a merge within the same store is allowed", () => {
    expect(canMerge(B_sameStore, A)).toBe(true);
  });

  test("a merge across stores is blocked — you cannot fold Wok Express into Spice Route", () => {
    expect(canMerge(B_otherStore, A)).toBe(false);
    expect(() => assertCanMerge(B_otherStore, A)).toThrow(/across stores/);
  });

  test("a terminal source cannot be merged", () => {
    expect(canMerge({ storeId: "store-a", status: "closed" }, A)).toBe(false);
    expect(() => assertCanMerge({ storeId: "store-a", status: "closed" }, A)).toThrow(/cannot be merged/);
  });

  test("a terminal target cannot receive a merge", () => {
    const closedTarget = { storeId: "store-a", status: "closed" as TableSessionStatus };
    expect(canMerge(B_sameStore, closedTarget)).toBe(false);
    expect(() => assertCanMerge(B_sameStore, closedTarget)).toThrow(/terminal state/);
  });

  test("store mismatch is checked before state — the message names the real problem", () => {
    // A cross-store merge where the source is also terminal must still
    // report the store mismatch, since that is the invariant that matters.
    const terminalOtherStore = { storeId: "store-b", status: "closed" as TableSessionStatus };
    expect(() => assertCanMerge(terminalOtherStore, A)).toThrow(/across stores/);
  });
});
