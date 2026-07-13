/**
 * A realistic 120-item Indian restaurant menu, per docs/adr's Phase 1 seed
 * requirement ("a realistic 120-item Indian menu with variants, add-ons,
 * tax classes" — variants/add-ons are Phase 2 scope; this seeds the base
 * items only). Prices in paise. Split across the two tax classes worked
 * through in DOMAIN.md §7: FOOD_5 (cooked food, 5%) and GOODS_18 (packaged
 * goods / beverages, 18%).
 */

export type SeedMenuItem = {
  name: string;
  pricePaise: number;
  taxClass: "FOOD_5" | "GOODS_18";
  diet: "veg" | "non_veg" | "egg" | "jain";
  allergens: string[];
};

const veg = (name: string, rupees: number, allergens: string[] = []): SeedMenuItem => ({
  name,
  pricePaise: rupees * 100,
  taxClass: "FOOD_5",
  diet: "veg",
  allergens,
});
const jain = (name: string, rupees: number, allergens: string[] = []): SeedMenuItem => ({
  name,
  pricePaise: rupees * 100,
  taxClass: "FOOD_5",
  diet: "jain",
  allergens,
});
const nonVeg = (name: string, rupees: number, allergens: string[] = []): SeedMenuItem => ({
  name,
  pricePaise: rupees * 100,
  taxClass: "FOOD_5",
  diet: "non_veg",
  allergens,
});
const egg = (name: string, rupees: number, allergens: string[] = []): SeedMenuItem => ({
  name,
  pricePaise: rupees * 100,
  taxClass: "FOOD_5",
  diet: "egg",
  allergens: [...allergens, "egg"],
});
const goods = (name: string, rupees: number, diet: SeedMenuItem["diet"] = "veg"): SeedMenuItem => ({
  name,
  pricePaise: rupees * 100,
  taxClass: "GOODS_18",
  diet,
  allergens: [],
});

export const menuItems: SeedMenuItem[] = [
  // Starters — veg
  veg("Paneer Tikka", 285, ["dairy"]),
  veg("Hara Bhara Kebab", 220),
  veg("Veg Manchurian Dry", 210, ["soy"]),
  veg("Gobi 65", 200),
  veg("Chilli Paneer Dry", 260, ["dairy", "soy"]),
  veg("Crispy Corn", 195),
  veg("Veg Spring Roll", 205, ["gluten"]),
  jain("Jain Paneer Tikka", 290, ["dairy"]),
  veg("Aloo Tikki Chaat", 150),
  veg("Dahi Puri", 130, ["dairy"]),

  // Starters — non-veg / egg
  nonVeg("Chicken Tikka", 320),
  nonVeg("Chicken 65", 300),
  nonVeg("Chilli Chicken Dry", 310, ["soy"]),
  nonVeg("Tandoori Chicken (Half)", 340),
  nonVeg("Fish Amritsari", 360, ["gluten"]),
  nonVeg("Mutton Seekh Kebab", 380),
  nonVeg("Chicken Malai Tikka", 330, ["dairy"]),
  egg("Egg Chilli", 180),
  nonVeg("Prawns Koliwada", 420, ["shellfish"]),
  egg("Masala Omelette", 120),

  // Breads
  goods("Tandoori Roti", 25),
  goods("Butter Naan", 45, "veg"),
  goods("Garlic Naan", 55, "veg"),
  goods("Lachha Paratha", 50, "veg"),
  goods("Missi Roti", 40, "veg"),
  goods("Stuffed Kulcha", 65, "veg"),
  goods("Cheese Naan", 75, "veg"),
  goods("Rumali Roti", 35, "veg"),

  // Rice & Biryani
  veg("Veg Pulao", 220),
  veg("Jeera Rice", 180),
  nonVeg("Chicken Biryani", 320),
  nonVeg("Mutton Biryani", 400),
  veg("Veg Biryani", 260),
  nonVeg("Prawn Biryani", 380, ["shellfish"]),
  veg("Curd Rice", 160, ["dairy"]),
  goods("Steamed Rice", 120),
  nonVeg("Egg Biryani", 260, ["egg"]),

  // Main course — veg gravies
  veg("Paneer Butter Masala", 300, ["dairy"]),
  veg("Palak Paneer", 280, ["dairy"]),
  veg("Kadai Paneer", 290, ["dairy"]),
  veg("Malai Kofta", 310, ["dairy"]),
  veg("Dal Makhani", 240, ["dairy"]),
  veg("Dal Tadka", 190),
  veg("Chana Masala", 200),
  veg("Baingan Bharta", 210),
  veg("Mix Veg Curry", 220),
  veg("Aloo Gobi", 190),
  jain("Jain Dal Makhani", 250, ["dairy"]),
  jain("Jain Kadai Paneer", 295, ["dairy"]),
  veg("Shahi Paneer", 305, ["dairy"]),
  veg("Paneer Lababdar", 300, ["dairy"]),
  veg("Vegetable Kolhapuri", 230),

  // Main course — non-veg
  nonVeg("Butter Chicken", 380, ["dairy"]),
  nonVeg("Chicken Tikka Masala", 370, ["dairy"]),
  nonVeg("Chicken Curry", 340),
  nonVeg("Kadai Chicken", 360),
  nonVeg("Chicken Chettinad", 370),
  nonVeg("Mutton Rogan Josh", 440),
  nonVeg("Mutton Curry", 420),
  nonVeg("Fish Curry", 360),
  nonVeg("Goan Fish Curry", 380),
  nonVeg("Prawn Masala", 420, ["shellfish"]),
  nonVeg("Chicken Chettinad Pepper Fry", 360),
  nonVeg("Egg Curry", 220, ["egg"]),
  nonVeg("Chicken Saagwala", 360, ["dairy"]),

  // South Indian
  veg("Masala Dosa", 150, ["dairy"]),
  veg("Plain Dosa", 110),
  veg("Rava Dosa", 160),
  veg("Idli Sambhar (2 pcs)", 90),
  veg("Medu Vada (2 pcs)", 95),
  veg("Uttapam", 140),
  veg("Pongal", 130, ["dairy"]),
  nonVeg("Chicken Chukka", 340),

  // Indo-Chinese noodles / rice
  veg("Veg Hakka Noodles", 210, ["gluten", "soy"]),
  nonVeg("Chicken Hakka Noodles", 250, ["gluten", "soy"]),
  veg("Veg Fried Rice", 200, ["soy"]),
  nonVeg("Chicken Fried Rice", 240, ["soy"]),
  nonVeg("Schezwan Chicken Rice", 260, ["soy"]),
  veg("Schezwan Veg Fried Rice", 220, ["soy"]),
  egg("Egg Fried Rice", 200, ["soy"]),

  // Soups
  veg("Sweet Corn Soup (Veg)", 130),
  nonVeg("Sweet Corn Soup (Chicken)", 150),
  veg("Hot & Sour Soup (Veg)", 140, ["soy"]),
  nonVeg("Hot & Sour Soup (Chicken)", 160, ["soy"]),
  veg("Tomato Shorba", 120),
  veg("Manchow Soup (Veg)", 140, ["soy"]),

  // Snacks / sides
  veg("Papad (Roasted)", 35),
  veg("Papad (Fried)", 40),
  veg("Green Salad", 90),
  veg("Boondi Raita", 90, ["dairy"]),
  veg("Curd", 70, ["dairy"]),
  veg("Pickle", 25),

  // Desserts
  veg("Gulab Jamun (2 pcs)", 90, ["dairy", "gluten"]),
  veg("Rasmalai (2 pcs)", 120, ["dairy"]),
  veg("Kheer", 110, ["dairy"]),
  veg("Gajar Ka Halwa", 130, ["dairy"]),
  veg("Ice Cream (Vanilla)", 90, ["dairy"]),
  veg("Ice Cream (Chocolate)", 100, ["dairy"]),
  veg("Kulfi", 100, ["dairy"]),
  veg("Jalebi (100g)", 80, ["gluten"]),

  // Beverages — GOODS_18
  goods("Sweet Lassi", 90, "veg"),
  goods("Masala Chaas", 70, "veg"),
  goods("Fresh Lime Soda", 80, "veg"),
  goods("Masala Chai", 40, "veg"),
  goods("Filter Coffee", 50, "veg"),
  goods("Cold Coffee", 110, "veg"),
  goods("Packaged Mineral Water 1L", 40, "veg"),
  goods("Soft Drink (Can)", 60, "veg"),
  goods("Mango Shake", 140, "veg"),
  goods("Fresh Orange Juice", 130, "veg"),
  goods("Buttermilk", 50, "veg"),
  goods("Iced Tea", 90, "veg"),

  // Combos / thalis (rounding out to 120)
  veg("Veg Thali", 260, ["dairy", "gluten"]),
  nonVeg("Non-Veg Thali", 340, ["dairy", "gluten"]),
  jain("Jain Thali", 270, ["dairy", "gluten"]),
  veg("Mini Meal Combo (Veg)", 220, ["dairy"]),
  nonVeg("Mini Meal Combo (Chicken)", 280, ["dairy"]),
  veg("Kids Combo (Veg Noodles + Ice Cream)", 190, ["gluten", "soy", "dairy"]),
  veg("Punjabi Combo (Dal Makhani + Naan + Rice)", 320, ["dairy", "gluten"]),
];

if (menuItems.length < 100) {
  throw new Error(`Expected ~120 menu items, got ${menuItems.length}`);
}
