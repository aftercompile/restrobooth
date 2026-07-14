import Link from "next/link";
import { schema } from "@restrobooth/db";
import { Badge, Button, Card, DataRow, TabularNumber } from "@restrobooth/ui";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { logout } from "./actions";

function formatRupees(paise: bigint): string {
  return `₹${(Number(paise) / 100).toFixed(2)}`;
}

const STATUS_TONE = { draft: "neutral", published: "live", archived: "warning" } as const;

export default async function MenuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { categories, items } = await queryAsCurrentUser(async (tx) => {
    const categories = await tx
      .select({ id: schema.categories.id, name: schema.categories.name, brandId: schema.categories.brandId })
      .from(schema.categories)
      .orderBy(schema.categories.sortOrder);
    const items = await tx
      .select({
        id: schema.menuItems.id,
        name: schema.menuItems.name,
        basePricePaise: schema.menuItems.basePricePaise,
        status: schema.menuItems.status,
        categoryId: schema.menuItems.categoryId,
      })
      .from(schema.menuItems);
    return { categories, items };
  });

  const itemsByCategory = new Map<string | null, typeof items>();
  for (const item of items) {
    const key = item.categoryId;
    if (!itemsByCategory.has(key)) itemsByCategory.set(key, []);
    itemsByCategory.get(key)!.push(item);
  }

  return (
    <main style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>Menu</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ fontSize: "var(--text-sm)" }}>{user?.email}</span>
          <form action={logout}>
            <button
              type="submit"
              style={{ font: "inherit", cursor: "pointer", background: "none", border: "none", textDecoration: "underline", color: "inherit" }}
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <div>
        <Link href="/menu/new">
          <Button variant="primary">New item</Button>
        </Link>
      </div>

      {categories.map((category) => (
        <Card key={category.id}>
          <DataRow label={<strong>{category.name}</strong>} />
          {(itemsByCategory.get(category.id) ?? []).map((item) => (
            <Link key={item.id} href={`/menu/${item.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <DataRow
                label={item.name}
                trailing={
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                    <TabularNumber>{formatRupees(item.basePricePaise)}</TabularNumber>
                    <Badge tone={STATUS_TONE[item.status as keyof typeof STATUS_TONE] ?? "neutral"}>{item.status}</Badge>
                  </span>
                }
              />
            </Link>
          ))}
          {(itemsByCategory.get(category.id) ?? []).length === 0 && (
            <p style={{ fontSize: "var(--text-sm)", opacity: 0.6, padding: "var(--space-1) var(--space-2)" }}>No items yet.</p>
          )}
        </Card>
      ))}

      {(itemsByCategory.get(null) ?? []).length > 0 && (
        <Card>
          <DataRow label={<strong>Uncategorised</strong>} />
          {(itemsByCategory.get(null) ?? []).map((item) => (
            <Link key={item.id} href={`/menu/${item.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              <DataRow
                label={item.name}
                trailing={
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                    <TabularNumber>{formatRupees(item.basePricePaise)}</TabularNumber>
                    <Badge tone={STATUS_TONE[item.status as keyof typeof STATUS_TONE] ?? "neutral"}>{item.status}</Badge>
                  </span>
                }
              />
            </Link>
          ))}
        </Card>
      )}

      {categories.length === 0 && items.length === 0 && (
        <p style={{ fontSize: "var(--text-sm)", opacity: 0.7 }}>No menu items yet. Create the first one.</p>
      )}
    </main>
  );
}
