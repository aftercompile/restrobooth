/**
 * Fixed, named UUIDs for the Phase 6 Slice 0 "Ember & Oak" fixture — a
 * separate org from the believable-chain fixture (fixture-ids.ts)
 * on purpose: that fixture is precision-tuned for the RLS adversarial
 * suite and the override precedence suite, and this one exists purely to
 * give the AI/reporting features believable transaction volume to
 * validate against. Sharing an org/brand/outlet namespace with it would
 * risk perturbing suites that assert on its exact shape. Every constant
 * here starts with "1" in the first UUID segment specifically so it can
 * never collide with fixture-ids.ts's "0"-prefixed constants even if
 * someone edits both files carelessly later.
 */

export const ORG = "10000000-0000-0000-0001-000000000001"; // Ember & Oak Hospitality Pvt Ltd

export const GST_MH = "10000000-0000-0000-0002-000000000001"; // Maharashtra (27)

export const BRAND = "10000000-0000-0000-0003-000000000001"; // Ember & Oak

export const OUTLET = "10000000-0000-0000-0004-000000000001"; // Mumbai — Bandra West

export const STORE = "10000000-0000-0000-0005-000000000001";

export const TERMINAL = "10000000-0000-0000-0006-000000000001";

export const AREA_MAIN = "10000000-0000-0000-0007-000000000001"; // Main Dining

// 8 tables, 4-top default capacity, two 2-tops and two 6-tops for variety.
export const TABLE_IDS = [
  "10000000-0000-0000-0008-000000000001",
  "10000000-0000-0000-0008-000000000002",
  "10000000-0000-0000-0008-000000000003",
  "10000000-0000-0000-0008-000000000004",
  "10000000-0000-0000-0008-000000000005",
  "10000000-0000-0000-0008-000000000006",
  "10000000-0000-0000-0008-000000000007",
  "10000000-0000-0000-0008-000000000008",
];

export const TAX_FOOD5 = "10000000-0000-0000-0009-000000000001"; // 5%, standalone-restaurant rate
export const TAX_GOODS18 = "10000000-0000-0000-0009-000000000002"; // 18% — beverages, matching the believable-chain fixture's own convention

export const INVOICE_SERIES = "10000000-0000-0000-000a-000000000001";
export const INVOICE_BLOCK = "10000000-0000-0000-000b-000000000001";
