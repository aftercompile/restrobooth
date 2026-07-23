/**
 * "Ember & Oak" — Phase 6 Slice 0's real-data-derived fixture menu.
 * Source: an owner-provided simulated POS export (12 items, a US-priced
 * steakhouse) — re-branded to an Indian premium grill per the owner's
 * explicit call (DECISIONS.md, 2026-07-23): same item shape and roughly
 * the same relative price spread, re-priced to realistic INR points and
 * two items renamed for an Indian menu (Shrimp -> Prawn is the local
 * term; everything else already reads naturally on an Indian premium-grill
 * menu as-is).
 *
 * `popularityWeight` and `category` are NOT from the source file — the
 * source's exact per-item counts weren't mechanically extractable at this
 * volume (see DECISIONS.md), so these are modelled weights approximating
 * the general shape observed (entrees anchor an order, sides/apps are
 * more frequent add-ons), not literal counts.
 *
 * Tax: FOOD_5 for all food categories (5% GST, the standalone-restaurant
 * rate — matches DOMAIN.md's worked examples and the believable-chain
 * fixture's own FOOD_5 convention). GOODS_18 for Beverage, matching that
 * SAME fixture's existing "beverages = GOODS_18" convention.
 *
 * Known, deliberate simplification: real Indian law puts alcohol OUTSIDE
 * GST (state excise/VAT instead) — not modelled anywhere in this codebase
 * yet (no schema concept for a non-GST tax regime). Taxing the two
 * alcoholic items at GOODS_18 is consistent with how this codebase
 * already treats every beverage, not a claim that it's legally precise.
 * A real gap, flagged rather than silently worked around — see
 * DECISIONS.md.
 */

export type StoreMenuCategory = "Appetizers" | "Sides" | "Entrees" | "Desserts" | "Beverages";

export interface StoreMenuItem {
  name: string;
  category: StoreMenuCategory;
  pricePaise: number;
  taxClass: "FOOD_5" | "GOODS_18";
  diet: "veg" | "non_veg" | "egg" | "jain";
  allergens: string[];
  kitchenSection: "hot" | "cold" | "bar";
  /** Relative frequency in a generated order's basket — see file header. */
  popularityWeight: number;
  isAlcoholic?: boolean;
}

const rupees = (r: number) => r * 100;

export const STEAKHOUSE_MENU: StoreMenuItem[] = [
  { name: "Truffle Fries", category: "Sides", pricePaise: rupees(280), taxClass: "FOOD_5", diet: "veg", allergens: ["dairy"], kitchenSection: "hot", popularityWeight: 9 },
  { name: "Grilled Asparagus", category: "Sides", pricePaise: rupees(280), taxClass: "FOOD_5", diet: "veg", allergens: [], kitchenSection: "hot", popularityWeight: 6 },
  { name: "Mashed Potatoes", category: "Sides", pricePaise: rupees(250), taxClass: "FOOD_5", diet: "veg", allergens: ["dairy"], kitchenSection: "hot", popularityWeight: 6 },
  { name: "Caesar Salad", category: "Appetizers", pricePaise: rupees(350), taxClass: "FOOD_5", diet: "veg", allergens: ["dairy", "gluten", "egg"], kitchenSection: "cold", popularityWeight: 7 },
  { name: "Prawn Cocktail", category: "Appetizers", pricePaise: rupees(450), taxClass: "FOOD_5", diet: "non_veg", allergens: ["shellfish"], kitchenSection: "cold", popularityWeight: 5 },
  { name: "Filet Mignon", category: "Entrees", pricePaise: rupees(1450), taxClass: "FOOD_5", diet: "non_veg", allergens: [], kitchenSection: "hot", popularityWeight: 5 },
  { name: "Ribeye Steak", category: "Entrees", pricePaise: rupees(1200), taxClass: "FOOD_5", diet: "non_veg", allergens: [], kitchenSection: "hot", popularityWeight: 6 },
  { name: "New York Strip", category: "Entrees", pricePaise: rupees(1300), taxClass: "FOOD_5", diet: "non_veg", allergens: [], kitchenSection: "hot", popularityWeight: 6 },
  { name: "Bourbon BBQ Burger", category: "Entrees", pricePaise: rupees(750), taxClass: "FOOD_5", diet: "non_veg", allergens: ["gluten", "dairy"], kitchenSection: "hot", popularityWeight: 8 },
  { name: "Chocolate Lava Cake", category: "Desserts", pricePaise: rupees(320), taxClass: "FOOD_5", diet: "veg", allergens: ["dairy", "egg", "gluten"], kitchenSection: "cold", popularityWeight: 6 },
  { name: "Cabernet Sauvignon", category: "Beverages", pricePaise: rupees(550), taxClass: "GOODS_18", diet: "veg", allergens: [], kitchenSection: "bar", popularityWeight: 5, isAlcoholic: true },
  { name: "Old Fashioned", category: "Beverages", pricePaise: rupees(450), taxClass: "GOODS_18", diet: "veg", allergens: [], kitchenSection: "bar", popularityWeight: 4, isAlcoholic: true },
];
