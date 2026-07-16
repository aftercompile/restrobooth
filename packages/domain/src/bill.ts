/**
 * computeBill() — the fixed order-of-operations pipeline from DOMAIN.md
 * §5.8, transcribed structurally (not just numerically) so the code reads
 * the same shape as the spec:
 *
 *   line_taxable    = line_gross − line_discount
 *   subtotal        = Σ line_taxable
 *   bill_discount    → allocated back to lines pro-rata by line_taxable
 *   charges          (service charge, packaging — pre-computed by the caller,
 *                     each tagged with the tax class it's taxed at)
 *   per tax class:   cgst/sgst (intra-state) or igst (inter-state),
 *                    each rounded half-up INDEPENDENTLY (§5 rule 3 — never
 *                    compute the combined rate and split the result)
 *   tax_total, gross, round_off (to the rupee), payable
 *
 * Server-authoritative by construction: this function has no knowledge of
 * who's calling it or when — the server recomputes it from scratch at
 * finalise and its answer wins (§5 rule 2). A client-side preview calls
 * the exact same function; there is no second implementation to drift.
 */
import { allocateLargestRemainder, roundPercentOf, roundTaxComponent, roundToRupee } from "./money";

export interface BillLineInput {
  /** Caller's own identifier (order_item id) — passed through untouched,
   *  purely so the result can be mapped back to a row. */
  id: string;
  /** unit_price × qty, plus any addon lines already summed in — this
   *  function starts at "gross for this line," it doesn't derive it. */
  grossPaise: bigint;
  /** A line-level discount (e.g. an item-specific %) — default 0. */
  lineDiscountPaise?: bigint;
  taxClassId: string;
}

export interface TaxRateInput {
  taxClassId: string;
  /** The class's combined rate in basis points (500 = 5%), matching
   *  tax_classes.rate_bps — NOT pre-split into CGST/SGST. */
  rateBps: number;
}

export type BillDiscountInput =
  | { kind: "none" }
  | { kind: "flat"; amountPaise: bigint }
  | { kind: "percent"; bps: number };

export interface BillChargeInput {
  name: string;
  taxClassId: string;
  /** Pre-computed by the caller — DOMAIN.md §7.3's "10% of the FOOD_5
   *  subtotal" is a UI-level decision about the base; this function only
   *  needs the resulting amount and which class it's taxed at. */
  amountPaise: bigint;
}

export interface ComputeBillInput {
  lines: BillLineInput[];
  taxRates: TaxRateInput[];
  billDiscount?: BillDiscountInput;
  charges?: BillChargeInput[];
  /** true → CGST+SGST (same state); false → IGST (different state).
   *  Mutually exclusive per DOMAIN.md §5.8 — never both on one bill. */
  isIntraState: boolean;
}

export interface BillLineResult {
  id: string;
  grossPaise: bigint;
  lineDiscountPaise: bigint;
  allocatedBillDiscountPaise: bigint;
  /** Final taxable value for this line, after both discounts. */
  taxablePaise: bigint;
  taxClassId: string;
}

export interface TaxLineResult {
  taxClassId: string;
  component: "cgst" | "sgst" | "igst";
  taxablePaise: bigint;
  rateBps: number;
  amountPaise: bigint;
}

export interface ComputeBillResult {
  lines: BillLineResult[];
  subtotalPaise: bigint;
  billDiscountPaise: bigint;
  chargesPaise: bigint;
  taxLines: TaxLineResult[];
  taxTotalPaise: bigint;
  /** subtotal − bill_discount + charges + tax_total, before rounding. */
  grossPaise: bigint;
  /** Signed — round_to_rupee(gross) − gross. */
  roundOffPaise: bigint;
  /** Invariant: payablePaise % 100n === 0n. */
  payablePaise: bigint;
}

export function computeBill(input: ComputeBillInput): ComputeBillResult {
  const billDiscount = input.billDiscount ?? { kind: "none" };
  const charges = input.charges ?? [];
  const rateByClass = new Map(input.taxRates.map((r) => [r.taxClassId, r.rateBps]));

  const lineTaxablesBeforeBillDiscount = input.lines.map((line) => {
    const lineDiscount = line.lineDiscountPaise ?? 0n;
    if (lineDiscount < 0n) throw new Error(`line ${line.id}: lineDiscountPaise must be non-negative`);
    if (lineDiscount > line.grossPaise) throw new Error(`line ${line.id}: lineDiscountPaise exceeds grossPaise`);
    return line.grossPaise - lineDiscount;
  });

  const subtotalPaise = lineTaxablesBeforeBillDiscount.reduce((a, b) => a + b, 0n);

  let billDiscountPaise: bigint;
  if (billDiscount.kind === "none") {
    billDiscountPaise = 0n;
  } else if (billDiscount.kind === "flat") {
    billDiscountPaise = billDiscount.amountPaise;
  } else {
    billDiscountPaise = roundPercentOf(subtotalPaise, billDiscount.bps);
  }
  if (billDiscountPaise < 0n) throw new Error("billDiscountPaise must be non-negative");
  if (billDiscountPaise > subtotalPaise) throw new Error("bill discount cannot exceed subtotal");

  // DOMAIN.md §5.8: allocated pro-rata by line_taxable, largest-remainder
  // so it sums to billDiscountPaise exactly.
  const allocatedDiscounts = allocateLargestRemainder(billDiscountPaise, lineTaxablesBeforeBillDiscount);

  const lines: BillLineResult[] = input.lines.map((line, i) => ({
    id: line.id,
    grossPaise: line.grossPaise,
    lineDiscountPaise: line.lineDiscountPaise ?? 0n,
    allocatedBillDiscountPaise: allocatedDiscounts[i]!,
    taxablePaise: lineTaxablesBeforeBillDiscount[i]! - allocatedDiscounts[i]!,
    taxClassId: line.taxClassId,
  }));

  // Group post-discount line taxable + charges by tax class — each class
  // is taxed on its own combined taxable value (§5.8).
  const taxableByClass = new Map<string, bigint>();
  for (const line of lines) {
    taxableByClass.set(line.taxClassId, (taxableByClass.get(line.taxClassId) ?? 0n) + line.taxablePaise);
  }
  let chargesPaise = 0n;
  for (const charge of charges) {
    if (charge.amountPaise < 0n) throw new Error(`charge "${charge.name}": amountPaise must be non-negative`);
    chargesPaise += charge.amountPaise;
    taxableByClass.set(charge.taxClassId, (taxableByClass.get(charge.taxClassId) ?? 0n) + charge.amountPaise);
  }

  const taxLines: TaxLineResult[] = [];
  let taxTotalPaise = 0n;
  for (const [taxClassId, classTaxable] of taxableByClass) {
    const rateBps = rateByClass.get(taxClassId);
    if (rateBps === undefined) throw new Error(`no tax rate provided for tax class ${taxClassId}`);

    if (input.isIntraState) {
      // GST rates are always structured to split evenly (5% -> 2.5+2.5,
      // 12% -> 6+6, 18% -> 9+9, 28% -> 14+14) — an odd combined rate would
      // mean CGST != SGST, which the invoice format requires to match.
      if (rateBps % 2 !== 0) {
        throw new Error(`tax class ${taxClassId}: rateBps ${rateBps} cannot split evenly into CGST+SGST`);
      }
      const halfBps = rateBps / 2;
      const cgst = roundTaxComponent(classTaxable, halfBps);
      const sgst = roundTaxComponent(classTaxable, halfBps);
      taxLines.push({ taxClassId, component: "cgst", taxablePaise: classTaxable, rateBps: halfBps, amountPaise: cgst });
      taxLines.push({ taxClassId, component: "sgst", taxablePaise: classTaxable, rateBps: halfBps, amountPaise: sgst });
      taxTotalPaise += cgst + sgst;
    } else {
      const igst = roundTaxComponent(classTaxable, rateBps);
      taxLines.push({ taxClassId, component: "igst", taxablePaise: classTaxable, rateBps, amountPaise: igst });
      taxTotalPaise += igst;
    }
  }

  const grossPaise = subtotalPaise - billDiscountPaise + chargesPaise + taxTotalPaise;
  const roundedPaise = roundToRupee(grossPaise);
  const roundOffPaise = roundedPaise - grossPaise;
  const payablePaise = grossPaise + roundOffPaise;

  return {
    lines,
    subtotalPaise,
    billDiscountPaise,
    chargesPaise,
    taxLines,
    taxTotalPaise,
    grossPaise,
    roundOffPaise,
    payablePaise,
  };
}
