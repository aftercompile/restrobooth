import { describe, expect, test } from "vitest";
import {
  assertOrderItemTransition,
  canTransitionOrderItem,
  voidRequiresAuth,
  type OrderItemStatus,
} from "./orderItem";

// Restated independently from DOMAIN.md §3.2's diagram.
const LEGAL: ReadonlyArray<[OrderItemStatus, OrderItemStatus]> = [
  ["pending", "fired"],
  ["pending", "voided"], // the free, pre-fire void
  ["fired", "served"],
  ["fired", "void_requested"],
  ["void_requested", "voided"], // approve
  ["void_requested", "fired"], // reject
];

const ALL: OrderItemStatus[] = ["pending", "fired", "served", "void_requested", "voided"];

describe("order_item transitions (DOMAIN.md §3.2)", () => {
  test("every documented transition is legal", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransitionOrderItem(from, to)).toBe(true);
    }
  });

  test("every undocumented transition is illegal", () => {
    const legalSet = new Set(LEGAL.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL) {
      for (const to of ALL) {
        if (legalSet.has(`${from}->${to}`)) continue;
        expect(canTransitionOrderItem(from, to)).toBe(false);
      }
    }
  });

  test("served and voided are terminal", () => {
    for (const to of ALL) {
      expect(canTransitionOrderItem("served", to)).toBe(false);
      expect(canTransitionOrderItem("voided", to)).toBe(false);
    }
  });

  test("assertOrderItemTransition throws on illegal, silent on legal", () => {
    expect(() => assertOrderItemTransition("served", "fired")).toThrow(/illegal order_item transition/);
    expect(() => assertOrderItemTransition("pending", "fired")).not.toThrow();
  });
});

describe("voidRequiresAuth — the fraud gate (DOMAIN.md §3.2)", () => {
  test("a pre-fire (pending) void is free — no manager auth", () => {
    expect(voidRequiresAuth("pending")).toBe(false);
  });

  test("a post-fire void always needs auth — food was cooked", () => {
    expect(voidRequiresAuth("fired")).toBe(true);
    expect(voidRequiresAuth("served")).toBe(true);
    expect(voidRequiresAuth("void_requested")).toBe(true);
  });
});
