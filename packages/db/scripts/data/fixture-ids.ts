/**
 * Fixed, named UUIDs for the believable-chain seed. Deliberately NOT
 * random — the RLS adversarial suite (docs/TENANCY.md §6) and the override
 * precedence suite (docs/TENANCY.md §7.4) are the next checkpoint, and both
 * need to reference these exact rows by name rather than re-deriving them.
 *
 * Every constant is a valid-looking UUID with a readable, grep-able tail so
 * a failing test's row id is legible without cross-referencing this file.
 */

// ---- Organizations -----------------------------------------------------
export const ORG1 = "00000000-0000-0000-0001-000000000001"; // Spice Route Hospitality
export const ORG2 = "00000000-0000-0000-0001-000000000002"; // Urban Bites Franchise (separate org — case A10)

// ---- GST registrations ---------------------------------------------------
export const GST_GJ = "00000000-0000-0000-0002-000000000001"; // org1, Gujarat (24)
export const GST_MH = "00000000-0000-0000-0002-000000000002"; // org1, Maharashtra (27)
export const GST_KA = "00000000-0000-0000-0002-000000000003"; // org2, Karnataka (29)

// ---- Brands ---------------------------------------------------------------
export const BRAND_A = "00000000-0000-0000-0003-00000000000a"; // Spice Route (org1) — the big multi-cuisine menu
export const BRAND_B = "00000000-0000-0000-0003-00000000000b"; // Wok Express (org1) — indo-chinese, shares Surat kitchen
export const BRAND_C = "00000000-0000-0000-0003-00000000000c"; // Urban Bites (org2)

// ---- Outlets ----------------------------------------------------------------
export const OUTLET_AMD = "00000000-0000-0000-0004-00000000000a"; // Ahmedabad, GJ — restaurant, Brand A only
export const OUTLET_SURAT = "00000000-0000-0000-0004-00000000000b"; // Surat, GJ — cloud_kitchen, Brand A + Brand B (the A8 case)
export const OUTLET_MUM = "00000000-0000-0000-0004-00000000000c"; // Mumbai, MH — restaurant, Brand B only
export const OUTLET_BLR = "00000000-0000-0000-0004-00000000000d"; // Bangalore, KA — org2's only outlet

// ---- Stores (brand x outlet) -----------------------------------------------
export const STORE_AMD_A = "00000000-0000-0000-0005-00000000000a";
export const STORE_SURAT_A = "00000000-0000-0000-0005-00000000000b"; // Brand A at the shared kitchen
export const STORE_SURAT_B = "00000000-0000-0000-0005-00000000000c"; // Brand B at the shared kitchen — sibling of the row above
export const STORE_MUM_B = "00000000-0000-0000-0005-00000000000d";
export const STORE_BLR_C = "00000000-0000-0000-0005-00000000000e";

// ---- Outlet group (cluster manager scope) ----------------------------------
export const OUTLET_GROUP_WEST = "00000000-0000-0000-0006-000000000001"; // {OUTLET_AMD, OUTLET_SURAT}

// ---- Tax classes (org-scoped) ----------------------------------------------
export const TAX_FOOD5_ORG1 = "00000000-0000-0000-0007-000000000001";
export const TAX_GOODS18_ORG1 = "00000000-0000-0000-0007-000000000002";
export const TAX_FOOD5_ORG2 = "00000000-0000-0000-0007-000000000003";
export const TAX_GOODS18_ORG2 = "00000000-0000-0000-0007-000000000004";

// ---- Users + memberships ---------------------------------------------------
// org1
export const USER_ORG1_OWNER = "00000000-0000-0000-0008-000000000001";
export const USER_BRANDA_MGR = "00000000-0000-0000-0008-000000000002"; // the A8 actor
export const USER_BRANDB_MGR = "00000000-0000-0000-0008-000000000003"; // A8's sibling brand
export const USER_WEST_CLUSTER = "00000000-0000-0000-0008-000000000004";
export const USER_AMD_MGR = "00000000-0000-0000-0008-000000000005";
export const USER_AMD_CASHIER = "00000000-0000-0000-0008-000000000006";
export const USER_AMD_CAPTAIN = "00000000-0000-0000-0008-000000000007";
export const USER_AMD_KITCHEN = "00000000-0000-0000-0008-000000000008";
export const USER_SURAT_MGR = "00000000-0000-0000-0008-000000000009";
export const USER_SURAT_CASHIER = "00000000-0000-0000-0008-00000000000a";
export const USER_SURAT_CAPTAIN = "00000000-0000-0000-0008-00000000000b";
export const USER_SURAT_KITCHEN = "00000000-0000-0000-0008-00000000000c";
export const USER_MUM_MGR = "00000000-0000-0000-0008-00000000000d";
export const USER_MUM_CASHIER = "00000000-0000-0000-0008-00000000000e";
export const USER_MUM_CAPTAIN = "00000000-0000-0000-0008-00000000000f";
export const USER_MUM_KITCHEN = "00000000-0000-0000-0008-000000000010";
// org2
export const USER_ORG2_OWNER = "00000000-0000-0000-0008-000000000020";

// ---- Areas, tables, terminals -----------------------------------------------
export const AREA_AMD_MAIN = "00000000-0000-0000-0009-00000000000a";
export const AREA_SURAT_MAIN = "00000000-0000-0000-0009-00000000000b"; // one kitchen area — no dine-in seating
export const AREA_MUM_MAIN = "00000000-0000-0000-0009-00000000000c";
export const AREA_BLR_MAIN = "00000000-0000-0000-0009-00000000000d";

export const TERMINAL_AMD_T1 = "00000000-0000-0000-000a-00000000000a";
export const TERMINAL_SURAT_T1 = "00000000-0000-0000-000a-00000000000b";
export const TERMINAL_MUM_T1 = "00000000-0000-0000-000a-00000000000c";
export const TERMINAL_BLR_T1 = "00000000-0000-0000-000a-00000000000d";

// ---- Business days (one open day per outlet, "today" in the seed's world) --
export const BIZDAY_AMD = "00000000-0000-0000-000b-00000000000a";
export const BIZDAY_SURAT = "00000000-0000-0000-000b-00000000000b";
export const BIZDAY_MUM = "00000000-0000-0000-000b-00000000000c";
export const BIZDAY_BLR = "00000000-0000-0000-000b-00000000000d";

// ---- A light table session + order + KOT + bill at Ahmedabad, to prove the
// schema end-to-end. Full transactional depth is bench/seed.ts's job at volume.
export const TABLE_SESSION_AMD_1 = "00000000-0000-0000-000c-000000000001";
export const ORDER_AMD_1 = "00000000-0000-0000-000d-000000000001";
export const KOT_AMD_1 = "00000000-0000-0000-000e-000000000001";
export const BILL_AMD_1 = "00000000-0000-0000-000f-000000000001";

export const INVOICE_SERIES_AMD = "00000000-0000-0000-0010-00000000000a";
export const INVOICE_SERIES_SURAT = "00000000-0000-0000-0010-00000000000b";
export const INVOICE_SERIES_MUM = "00000000-0000-0000-0010-00000000000c";
export const INVOICE_SERIES_BLR = "00000000-0000-0000-0010-00000000000d";

// ---- Named tables + a second AMD table session, for the anonymous-guest
// adversarial cases (TENANCY.md §6 A11-A14): "T5" and "T6" in the doc's
// generic naming. A guest scanning T5's QR must not be able to read
// orders that belong to T6's session, even though both are the same
// outlet — table-level isolation, not just outlet-level.
export const TABLE_AMD_1 = "00000000-0000-0000-0011-000000000001"; // = T5: bound to TABLE_SESSION_AMD_1
export const TABLE_AMD_2 = "00000000-0000-0000-0011-000000000002"; // = T6: its own separate session

export const TABLE_SESSION_AMD_2 = "00000000-0000-0000-000c-000000000002";
export const ORDER_AMD_2 = "00000000-0000-0000-000d-000000000002";

export const QR_TOKEN_AMD_T1 = "00000000-0000-0000-0012-000000000001"; // bound to TABLE_AMD_1
export const GUEST_SESSION_AMD_T1 = "00000000-0000-0000-0013-000000000001"; // bound to TABLE_SESSION_AMD_1
