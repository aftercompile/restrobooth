/**
 * DOMAIN.md §6 — invoice numbering. CGST Rule 46(b): a consecutive serial
 * number, not exceeding sixteen characters, in one or multiple series,
 * containing alphabets, numerals, hyphen, and slash, unique for a
 * financial year. This module is the pure, belt-and-suspenders half of
 * that rule (the DB carries the identical constraint —
 * `packages/db/src/schema/invoicing.ts`'s `invoice_no_legal` check — so a
 * malformed number is caught here, before it ever reaches Postgres, not
 * instead of being caught there).
 */

const INVOICE_NUMBER_PATTERN = /^[A-Za-z0-9/-]+$/;
const MAX_INVOICE_NUMBER_LENGTH = 16;

export function isValidInvoiceNumber(invoiceNo: string): boolean {
  return invoiceNo.length > 0 && invoiceNo.length <= MAX_INVOICE_NUMBER_LENGTH && INVOICE_NUMBER_PATTERN.test(invoiceNo);
}

export function assertValidInvoiceNumber(invoiceNo: string): void {
  if (!isValidInvoiceNumber(invoiceNo)) {
    throw new Error(
      `invalid invoice number "${invoiceNo}": must be 1-${MAX_INVOICE_NUMBER_LENGTH} chars, matching ${INVOICE_NUMBER_PATTERN} (CGST Rule 46(b))`,
    );
  }
}

/**
 * `{SERIES}/{FY}/{SEQ}` — DOMAIN.md §6.2's format. `seqWidth` is a
 * display/padding choice (the doc's own examples use 6 digits for the
 * default series, 5 for the shorter offline/credit-note series codes so
 * the total stays comfortably under 16) — this function doesn't hardcode
 * one, it validates whatever the caller picked against the real 16-char
 * ceiling, since that's the actual legal constraint.
 */
export function formatInvoiceNumber(seriesCode: string, financialYear: string, seq: bigint, seqWidth = 6): string {
  if (seq < 0n) throw new Error("formatInvoiceNumber: seq must be non-negative");
  const seqStr = seq.toString().padStart(seqWidth, "0");
  const invoiceNo = `${seriesCode}/${financialYear}/${seqStr}`;
  assertValidInvoiceNumber(invoiceNo);
  return invoiceNo;
}

/**
 * DOMAIN.md §6.1: the financial year is April–March, not the calendar
 * year, and it's derived from `business_date` (a `date`, never a client
 * timestamp — CLAUDE.md's standing rule) — hence a plain "YYYY-MM-DD"
 * string input rather than a JS `Date`, which would invite a timezone bug
 * exactly where this project already spent effort avoiding one.
 *
 * `FY(2026-07-13) = '2627'`; a bill on 2027-03-31 is still FY 2627; one on
 * 2027-04-01 is FY 2728 and the sequence resets to 1 (the reset itself is
 * the invoice-series allocator's job, not this function's — this only
 * computes the label).
 */
export function financialYearFor(businessDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(businessDate);
  if (!match) throw new Error(`financialYearFor: expected "YYYY-MM-DD", got "${businessDate}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const startYear = month >= 4 ? year : year - 1;
  const yy = (startYear % 100).toString().padStart(2, "0");
  const yyNext = ((startYear + 1) % 100).toString().padStart(2, "0");
  return `${yy}${yyNext}`;
}
