import { schema } from "@restrobooth/db";
import { queryAsCurrentUser } from "../../../lib/db";
import { NewItemForm } from "./NewItemForm";

export default async function NewMenuItemPage() {
  const { brands, categories, taxClasses } = await queryAsCurrentUser(async (tx) => {
    const brands = await tx.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands);
    const categories = await tx
      .select({ id: schema.categories.id, name: schema.categories.name, brandId: schema.categories.brandId })
      .from(schema.categories);
    const taxClasses = await tx
      .select({ id: schema.taxClasses.id, code: schema.taxClasses.code, rateBps: schema.taxClasses.rateBps })
      .from(schema.taxClasses);
    return { brands, categories, taxClasses };
  });

  return (
    <main style={{ padding: "var(--space-3)", maxWidth: 480 }}>
      <h1 style={{ fontFamily: "var(--font-display)", marginBottom: "var(--space-3)" }}>New menu item</h1>
      <NewItemForm brands={brands} categories={categories} taxClasses={taxClasses} />
    </main>
  );
}
