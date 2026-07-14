import { schema } from "@restrobooth/db";
import { Animate, Card, PageHeader } from "@restrobooth/ui";
import { queryAsCurrentUser } from "../../../lib/db";
import { createClient } from "../../../lib/supabase/server";
import { ConsoleShell } from "../../ConsoleShell";
import { NewItemForm } from "./NewItemForm";

export default async function NewMenuItemPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    <ConsoleShell email={user?.email}>
      <PageHeader
        title="New item"
        subtitle="Items are defined once, at brand level. Store-specific prices and 86s come after — on the item's own page."
      />
      <Animate>
        <Card style={{ maxWidth: 520 }}>
          <NewItemForm brands={brands} categories={categories} taxClasses={taxClasses} />
        </Card>
      </Animate>
    </ConsoleShell>
  );
}
