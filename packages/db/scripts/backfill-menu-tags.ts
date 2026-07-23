/**
 * `pnpm --filter @restrobooth/db backfill:menu-tags` — Phase 6 Slice 2.
 *
 * Backfills `spice_level` and `tags` on every existing `menu_items` row,
 * matched by exact name. Hand-authored per dish (real culinary judgement
 * — comfort-food gravies read mild, Chettinad/Kolhapuri/Schezwan read
 * hot, indo-chinese dry starters read hot, tandoor items read medium,
 * breads/rice/desserts/beverages read mild), not derived or randomized —
 * this is what makes the Booth Host's spice/mood filter actually mean
 * something instead of being decorative.
 *
 * Additive/idempotent: only ever UPDATEs rows that already exist (from
 * `pnpm seed` and/or `pnpm import:steakhouse`), matched by name. A name
 * with no entry here is left alone (spice_level stays null, tags stay
 * empty) rather than guessed at — logged so it's visible, not silent.
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDbClient, type Database } from "../src/client.js";
import * as schema from "../src/schema/index.js";

type SpiceLevel = "mild" | "medium" | "hot";
interface Tagging {
  spiceLevel: SpiceLevel;
  tags: string[];
}

const TAGS: Record<string, Tagging> = {
  // Starters — veg
  "Paneer Tikka": { spiceLevel: "medium", tags: ["shareable", "tandoor"] },
  "Hara Bhara Kebab": { spiceLevel: "mild", tags: ["shareable", "healthy"] },
  "Veg Manchurian Dry": { spiceLevel: "medium", tags: ["shareable", "indo-chinese"] },
  "Gobi 65": { spiceLevel: "hot", tags: ["shareable", "indo-chinese", "crispy"] },
  "Chilli Paneer Dry": { spiceLevel: "hot", tags: ["shareable", "indo-chinese"] },
  "Crispy Corn": { spiceLevel: "mild", tags: ["shareable", "quick-bite"] },
  "Veg Spring Roll": { spiceLevel: "mild", tags: ["shareable", "indo-chinese"] },
  "Jain Paneer Tikka": { spiceLevel: "medium", tags: ["shareable", "tandoor", "jain-friendly"] },
  "Aloo Tikki Chaat": { spiceLevel: "medium", tags: ["street-food", "tangy"] },
  "Dahi Puri": { spiceLevel: "mild", tags: ["street-food", "tangy", "cooling"] },

  // Starters — non-veg / egg
  "Chicken Tikka": { spiceLevel: "medium", tags: ["shareable", "tandoor"] },
  "Chicken 65": { spiceLevel: "hot", tags: ["shareable", "crispy"] },
  "Chilli Chicken Dry": { spiceLevel: "hot", tags: ["shareable", "indo-chinese"] },
  "Tandoori Chicken (Half)": { spiceLevel: "medium", tags: ["shareable", "tandoor", "signature"] },
  "Fish Amritsari": { spiceLevel: "medium", tags: ["shareable", "crispy"] },
  "Mutton Seekh Kebab": { spiceLevel: "medium", tags: ["shareable", "tandoor"] },
  "Chicken Malai Tikka": { spiceLevel: "mild", tags: ["shareable", "tandoor", "creamy"] },
  "Egg Chilli": { spiceLevel: "hot", tags: ["shareable", "indo-chinese"] },
  "Prawns Koliwada": { spiceLevel: "hot", tags: ["shareable", "crispy", "coastal"] },
  "Masala Omelette": { spiceLevel: "mild", tags: ["quick-bite", "comfort"] },

  // Breads
  "Tandoori Roti": { spiceLevel: "mild", tags: ["staple", "bread"] },
  "Butter Naan": { spiceLevel: "mild", tags: ["staple", "bread"] },
  "Garlic Naan": { spiceLevel: "mild", tags: ["staple", "bread"] },
  "Lachha Paratha": { spiceLevel: "mild", tags: ["staple", "bread"] },
  "Missi Roti": { spiceLevel: "mild", tags: ["staple", "bread"] },
  "Stuffed Kulcha": { spiceLevel: "mild", tags: ["staple", "bread"] },
  "Cheese Naan": { spiceLevel: "mild", tags: ["staple", "bread", "indulgent"] },
  "Rumali Roti": { spiceLevel: "mild", tags: ["staple", "bread"] },

  // Rice & Biryani
  "Veg Pulao": { spiceLevel: "mild", tags: ["comfort", "light"] },
  "Jeera Rice": { spiceLevel: "mild", tags: ["staple", "light"] },
  "Chicken Biryani": { spiceLevel: "medium", tags: ["signature", "hearty", "shareable"] },
  "Mutton Biryani": { spiceLevel: "medium", tags: ["signature", "hearty", "shareable"] },
  "Veg Biryani": { spiceLevel: "medium", tags: ["hearty", "shareable"] },
  "Prawn Biryani": { spiceLevel: "medium", tags: ["signature", "hearty", "coastal"] },
  "Curd Rice": { spiceLevel: "mild", tags: ["cooling", "comfort", "light"] },
  "Steamed Rice": { spiceLevel: "mild", tags: ["staple", "light"] },
  "Egg Biryani": { spiceLevel: "medium", tags: ["hearty"] },

  // Main course — veg gravies
  "Paneer Butter Masala": { spiceLevel: "mild", tags: ["comfort", "creamy", "crowd-pleaser"] },
  "Palak Paneer": { spiceLevel: "mild", tags: ["comfort", "healthy"] },
  "Kadai Paneer": { spiceLevel: "medium", tags: ["comfort"] },
  "Malai Kofta": { spiceLevel: "mild", tags: ["comfort", "creamy", "festive"] },
  "Dal Makhani": { spiceLevel: "mild", tags: ["comfort", "creamy", "staple"] },
  "Dal Tadka": { spiceLevel: "mild", tags: ["comfort", "healthy", "light"] },
  "Chana Masala": { spiceLevel: "medium", tags: ["comfort", "healthy"] },
  "Baingan Bharta": { spiceLevel: "medium", tags: ["comfort", "smoky"] },
  "Mix Veg Curry": { spiceLevel: "mild", tags: ["comfort", "healthy"] },
  "Aloo Gobi": { spiceLevel: "mild", tags: ["comfort", "staple"] },
  "Jain Dal Makhani": { spiceLevel: "mild", tags: ["comfort", "jain-friendly", "creamy"] },
  "Jain Kadai Paneer": { spiceLevel: "medium", tags: ["comfort", "jain-friendly"] },
  "Shahi Paneer": { spiceLevel: "mild", tags: ["comfort", "creamy", "festive"] },
  "Paneer Lababdar": { spiceLevel: "mild", tags: ["comfort", "creamy"] },
  "Vegetable Kolhapuri": { spiceLevel: "hot", tags: ["comfort", "spicy-regional"] },

  // Main course — non-veg
  "Butter Chicken": { spiceLevel: "mild", tags: ["signature", "comfort", "creamy", "crowd-pleaser"] },
  "Chicken Tikka Masala": { spiceLevel: "medium", tags: ["signature", "comfort", "creamy"] },
  "Chicken Curry": { spiceLevel: "medium", tags: ["comfort", "staple"] },
  "Kadai Chicken": { spiceLevel: "hot", tags: ["comfort"] },
  "Chicken Chettinad": { spiceLevel: "hot", tags: ["spicy-regional", "coastal"] },
  "Mutton Rogan Josh": { spiceLevel: "hot", tags: ["signature", "spicy-regional"] },
  "Mutton Curry": { spiceLevel: "medium", tags: ["comfort", "hearty"] },
  "Fish Curry": { spiceLevel: "medium", tags: ["comfort", "coastal"] },
  "Goan Fish Curry": { spiceLevel: "hot", tags: ["coastal", "spicy-regional"] },
  "Prawn Masala": { spiceLevel: "hot", tags: ["coastal", "spicy-regional"] },
  "Chicken Chettinad Pepper Fry": { spiceLevel: "hot", tags: ["spicy-regional", "dry"] },
  "Egg Curry": { spiceLevel: "medium", tags: ["comfort", "staple"] },
  "Chicken Saagwala": { spiceLevel: "mild", tags: ["comfort", "healthy"] },

  // South Indian
  "Masala Dosa": { spiceLevel: "mild", tags: ["breakfast", "light", "crispy"] },
  "Plain Dosa": { spiceLevel: "mild", tags: ["breakfast", "light", "crispy"] },
  "Rava Dosa": { spiceLevel: "mild", tags: ["breakfast", "light", "crispy"] },
  "Idli Sambhar (2 pcs)": { spiceLevel: "mild", tags: ["breakfast", "light", "healthy"] },
  "Medu Vada (2 pcs)": { spiceLevel: "mild", tags: ["breakfast", "crispy"] },
  Uttapam: { spiceLevel: "mild", tags: ["breakfast", "light"] },
  Pongal: { spiceLevel: "mild", tags: ["breakfast", "comfort"] },
  "Chicken Chukka": { spiceLevel: "hot", tags: ["spicy-regional", "dry"] },

  // Indo-Chinese noodles / rice
  "Veg Hakka Noodles": { spiceLevel: "medium", tags: ["indo-chinese", "shareable"] },
  "Chicken Hakka Noodles": { spiceLevel: "medium", tags: ["indo-chinese", "shareable"] },
  "Veg Fried Rice": { spiceLevel: "mild", tags: ["indo-chinese", "staple"] },
  "Chicken Fried Rice": { spiceLevel: "mild", tags: ["indo-chinese", "staple"] },
  "Schezwan Chicken Rice": { spiceLevel: "hot", tags: ["indo-chinese", "spicy"] },
  "Schezwan Veg Fried Rice": { spiceLevel: "hot", tags: ["indo-chinese", "spicy"] },
  "Egg Fried Rice": { spiceLevel: "mild", tags: ["indo-chinese", "staple"] },

  // Soups
  "Sweet Corn Soup (Veg)": { spiceLevel: "mild", tags: ["light", "comfort", "starter"] },
  "Sweet Corn Soup (Chicken)": { spiceLevel: "mild", tags: ["light", "comfort", "starter"] },
  "Hot & Sour Soup (Veg)": { spiceLevel: "hot", tags: ["light", "starter", "tangy"] },
  "Hot & Sour Soup (Chicken)": { spiceLevel: "hot", tags: ["light", "starter", "tangy"] },
  "Tomato Shorba": { spiceLevel: "mild", tags: ["light", "comfort", "starter"] },
  "Manchow Soup (Veg)": { spiceLevel: "hot", tags: ["light", "starter", "indo-chinese"] },

  // Snacks / sides
  "Papad (Roasted)": { spiceLevel: "mild", tags: ["light", "side", "healthy"] },
  "Papad (Fried)": { spiceLevel: "mild", tags: ["light", "side", "crispy"] },
  "Green Salad": { spiceLevel: "mild", tags: ["light", "healthy", "side"] },
  "Boondi Raita": { spiceLevel: "mild", tags: ["cooling", "side", "comfort"] },
  Curd: { spiceLevel: "mild", tags: ["cooling", "side", "healthy"] },
  Pickle: { spiceLevel: "hot", tags: ["side", "tangy"] },

  // Desserts
  "Gulab Jamun (2 pcs)": { spiceLevel: "mild", tags: ["dessert", "sweet", "festive"] },
  "Rasmalai (2 pcs)": { spiceLevel: "mild", tags: ["dessert", "sweet", "creamy", "festive"] },
  Kheer: { spiceLevel: "mild", tags: ["dessert", "sweet", "comfort"] },
  "Gajar Ka Halwa": { spiceLevel: "mild", tags: ["dessert", "sweet", "comfort", "seasonal"] },
  "Ice Cream (Vanilla)": { spiceLevel: "mild", tags: ["dessert", "sweet", "cooling"] },
  "Ice Cream (Chocolate)": { spiceLevel: "mild", tags: ["dessert", "sweet", "cooling"] },
  Kulfi: { spiceLevel: "mild", tags: ["dessert", "sweet", "cooling", "traditional"] },
  "Jalebi (100g)": { spiceLevel: "mild", tags: ["dessert", "sweet", "festive"] },

  // Beverages
  "Sweet Lassi": { spiceLevel: "mild", tags: ["beverage", "cooling", "sweet"] },
  "Masala Chaas": { spiceLevel: "mild", tags: ["beverage", "cooling", "tangy"] },
  "Fresh Lime Soda": { spiceLevel: "mild", tags: ["beverage", "cooling", "light"] },
  "Masala Chai": { spiceLevel: "mild", tags: ["beverage", "comfort"] },
  "Filter Coffee": { spiceLevel: "mild", tags: ["beverage", "comfort"] },
  "Cold Coffee": { spiceLevel: "mild", tags: ["beverage", "cooling", "sweet"] },
  "Packaged Mineral Water 1L": { spiceLevel: "mild", tags: ["beverage"] },
  "Soft Drink (Can)": { spiceLevel: "mild", tags: ["beverage", "cooling"] },
  "Mango Shake": { spiceLevel: "mild", tags: ["beverage", "cooling", "sweet"] },
  "Fresh Orange Juice": { spiceLevel: "mild", tags: ["beverage", "cooling", "healthy"] },
  Buttermilk: { spiceLevel: "mild", tags: ["beverage", "cooling", "healthy"] },
  "Iced Tea": { spiceLevel: "mild", tags: ["beverage", "cooling"] },

  // Combos / thalis
  "Veg Thali": { spiceLevel: "mild", tags: ["hearty", "shareable", "value"] },
  "Non-Veg Thali": { spiceLevel: "medium", tags: ["hearty", "shareable", "value"] },
  "Jain Thali": { spiceLevel: "mild", tags: ["hearty", "jain-friendly", "value"] },
  "Mini Meal Combo (Veg)": { spiceLevel: "mild", tags: ["quick-bite", "value"] },
  "Mini Meal Combo (Chicken)": { spiceLevel: "medium", tags: ["quick-bite", "value"] },
  "Kids Combo (Veg Noodles + Ice Cream)": { spiceLevel: "mild", tags: ["kids-friendly", "quick-bite"] },
  "Punjabi Combo (Dal Makhani + Naan + Rice)": { spiceLevel: "mild", tags: ["hearty", "comfort", "value"] },

  // Ember & Oak
  "Truffle Fries": { spiceLevel: "mild", tags: ["shareable", "comfort", "indulgent"] },
  "Grilled Asparagus": { spiceLevel: "mild", tags: ["healthy", "light", "side"] },
  "Mashed Potatoes": { spiceLevel: "mild", tags: ["comfort", "side"] },
  "Caesar Salad": { spiceLevel: "mild", tags: ["light", "healthy", "starter"] },
  "Prawn Cocktail": { spiceLevel: "mild", tags: ["starter", "coastal", "chilled"] },
  "Filet Mignon": { spiceLevel: "mild", tags: ["signature", "hearty", "premium"] },
  "Ribeye Steak": { spiceLevel: "mild", tags: ["signature", "hearty", "premium"] },
  "New York Strip": { spiceLevel: "mild", tags: ["signature", "hearty", "premium"] },
  "Bourbon BBQ Burger": { spiceLevel: "medium", tags: ["hearty", "shareable", "comfort"] },
  "Chocolate Lava Cake": { spiceLevel: "mild", tags: ["dessert", "sweet", "indulgent"] },
  "Cabernet Sauvignon": { spiceLevel: "mild", tags: ["beverage", "alcoholic"] },
  "Old Fashioned": { spiceLevel: "mild", tags: ["beverage", "alcoholic"] },
};

export async function backfillMenuTags(db: Database): Promise<void> {
  const rows = await db.select({ id: schema.menuItems.id, name: schema.menuItems.name }).from(schema.menuItems);
  let updated = 0;
  const unmatched: string[] = [];
  for (const row of rows) {
    const tagging = TAGS[row.name];
    if (!tagging) {
      unmatched.push(row.name);
      continue;
    }
    await db.update(schema.menuItems).set({ spiceLevel: tagging.spiceLevel, tags: tagging.tags }).where(eq(schema.menuItems.id, row.id));
    updated++;
  }
  console.log(`Tagged ${updated}/${rows.length} menu items.`);
  if (unmatched.length > 0) {
    console.log(`Unmatched (left untagged, name not in the lookup table): ${unmatched.join(", ")}`);
  }
}

async function cliMain() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(here, "../../../.env") });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  await backfillMenuTags(createDbClient(url));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cliMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
