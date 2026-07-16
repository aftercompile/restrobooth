import { describe, expect, test } from "vitest";
import { assertValidInvoiceNumber, financialYearFor, formatInvoiceNumber, isValidInvoiceNumber } from "./invoiceNumber";

describe("financialYearFor — DOMAIN.md §6.1: April-March, not calendar year", () => {
  test("FY(2026-07-13) = 2627, the doc's own example", () => {
    expect(financialYearFor("2026-07-13")).toBe("2627");
  });

  test("2027-03-31 is still FY 2627 — the last day of the financial year", () => {
    expect(financialYearFor("2027-03-31")).toBe("2627");
  });

  test("2027-04-01 rolls over to FY 2728 — the first day of the next one", () => {
    expect(financialYearFor("2027-04-01")).toBe("2728");
  });

  test("January is still the PRIOR financial year", () => {
    expect(financialYearFor("2027-01-15")).toBe("2627");
  });

  test("rejects a malformed date string", () => {
    expect(() => financialYearFor("13-07-2026")).toThrow();
    expect(() => financialYearFor("2026/07/13")).toThrow();
    expect(() => financialYearFor("not-a-date")).toThrow();
  });
});

describe("formatInvoiceNumber — DOMAIN.md §6.2's three example series", () => {
  test("outlet default series: A1/2627/000123 (14 chars)", () => {
    const invoiceNo = formatInvoiceNumber("A1", "2627", 123n, 6);
    expect(invoiceNo).toBe("A1/2627/000123");
    expect(invoiceNo).toHaveLength(14);
  });

  test("terminal offline fallback series: A1T2/2627/00123 (15 chars)", () => {
    const invoiceNo = formatInvoiceNumber("A1T2", "2627", 123n, 5);
    expect(invoiceNo).toBe("A1T2/2627/00123");
    expect(invoiceNo).toHaveLength(15);
  });

  test("credit note series: A1CN/2627/00042 (15 chars)", () => {
    const invoiceNo = formatInvoiceNumber("A1CN", "2627", 42n, 5);
    expect(invoiceNo).toBe("A1CN/2627/00042");
    expect(invoiceNo).toHaveLength(15);
  });

  test("throws rather than silently truncate when the result would exceed 16 chars", () => {
    expect(() => formatInvoiceNumber("VERYLONGSERIES", "2627", 1n, 6)).toThrow();
  });

  test("rejects a negative sequence number", () => {
    expect(() => formatInvoiceNumber("A1", "2627", -1n)).toThrow();
  });
});

describe("isValidInvoiceNumber / assertValidInvoiceNumber — CGST Rule 46(b)", () => {
  test("accepts a well-formed number at exactly the 16-char ceiling", () => {
    const sixteen = "A123456789012345".slice(0, 16);
    expect(sixteen).toHaveLength(16);
    expect(isValidInvoiceNumber(sixteen)).toBe(true);
  });

  test("rejects anything over 16 characters", () => {
    expect(isValidInvoiceNumber("A1234567890123456")).toBe(false); // 17 chars
  });

  test("rejects an empty string", () => {
    expect(isValidInvoiceNumber("")).toBe(false);
  });

  test("accepts hyphens and slashes, the two legally-permitted punctuation marks", () => {
    expect(isValidInvoiceNumber("A1-B2/2627/1")).toBe(true);
  });

  test("rejects any other punctuation or whitespace", () => {
    expect(isValidInvoiceNumber("A1#2627#1")).toBe(false);
    expect(isValidInvoiceNumber("A1 2627 1")).toBe(false);
    expect(isValidInvoiceNumber("A1_2627_1")).toBe(false);
  });

  test("assertValidInvoiceNumber throws with a message naming the legal rule, not just \"invalid\"", () => {
    expect(() => assertValidInvoiceNumber("bad number")).toThrow(/Rule 46/);
  });

  test("assertValidInvoiceNumber is silent on a valid number", () => {
    expect(() => assertValidInvoiceNumber("A1/2627/000123")).not.toThrow();
  });
});
