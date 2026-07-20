import { describe, expect, test } from "vitest";
import { buildUpiIntentUrl } from "./upi";

describe("buildUpiIntentUrl — NPCI upi://pay deep link", () => {
  test("builds a well-formed link with all params", () => {
    const url = buildUpiIntentUrl({
      vpa: "spiceroute.vastrapur@upi",
      payeeName: "Spice Route Hospitality Pvt Ltd",
      amountPaise: 45000n,
      note: "A1/2627/000123",
    });
    expect(url.startsWith("upi://pay?")).toBe(true);
    const params = new URLSearchParams(url.slice("upi://pay?".length));
    expect(params.get("pa")).toBe("spiceroute.vastrapur@upi");
    expect(params.get("pn")).toBe("Spice Route Hospitality Pvt Ltd");
    expect(params.get("am")).toBe("450.00");
    expect(params.get("cu")).toBe("INR");
    expect(params.get("tn")).toBe("A1/2627/000123");
  });

  test("amount formatting: whole rupees still show two decimal places", () => {
    const url = buildUpiIntentUrl({ vpa: "a@upi", payeeName: "A", amountPaise: 10000n, note: "x" });
    expect(new URLSearchParams(url.slice(10)).get("am")).toBe("100.00");
  });

  test("amount formatting: a single-digit paise remainder is zero-padded", () => {
    const url = buildUpiIntentUrl({ vpa: "a@upi", payeeName: "A", amountPaise: 10005n, note: "x" });
    expect(new URLSearchParams(url.slice(10)).get("am")).toBe("100.05");
  });

  test("amount formatting: sub-rupee amounts", () => {
    const url = buildUpiIntentUrl({ vpa: "a@upi", payeeName: "A", amountPaise: 50n, note: "x" });
    expect(new URLSearchParams(url.slice(10)).get("am")).toBe("0.50");
  });

  test("a payee name with spaces and special characters is percent-encoded, and decodes back correctly", () => {
    const url = buildUpiIntentUrl({
      vpa: "a@upi",
      payeeName: "Joe's Café & Bar",
      amountPaise: 100n,
      note: "table 4",
    });
    const params = new URLSearchParams(url.slice("upi://pay?".length));
    expect(params.get("pn")).toBe("Joe's Café & Bar");
    expect(params.get("tn")).toBe("table 4");
  });

  test("rejects a zero amount", () => {
    expect(() => buildUpiIntentUrl({ vpa: "a@upi", payeeName: "A", amountPaise: 0n, note: "x" })).toThrow();
  });

  test("rejects a negative amount", () => {
    expect(() => buildUpiIntentUrl({ vpa: "a@upi", payeeName: "A", amountPaise: -100n, note: "x" })).toThrow();
  });

  test("rejects an empty vpa", () => {
    expect(() => buildUpiIntentUrl({ vpa: "", payeeName: "A", amountPaise: 100n, note: "x" })).toThrow();
    expect(() => buildUpiIntentUrl({ vpa: "   ", payeeName: "A", amountPaise: 100n, note: "x" })).toThrow();
  });

  test("rejects an empty payee name", () => {
    expect(() => buildUpiIntentUrl({ vpa: "a@upi", payeeName: "", amountPaise: 100n, note: "x" })).toThrow();
  });
});
