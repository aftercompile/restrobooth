import Link from "next/link";
import { eq, schema } from "@restrobooth/db";
import { Animate, Badge, Button, Card, CardHeader, DataRow, PageHeader, TabularNumber } from "@restrobooth/ui";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { ConsoleShell } from "../ConsoleShell";

function rupees(paise: bigint): string {
  return `₹${(Number(paise) / 100).toFixed(2)}`;
}

/**
 * The state rail's meaning on a menu item. A menu item's state is a
 * LIFECYCLE, not a temperature — so it maps onto the rail's lifecycle
 * family, not the time-temperature ramp (see StateRail's own header).
 *
 * The rail is the only thing encoding this with colour; the Badge repeats
 * it in words, because colour is never the only channel.
 */
function railFor(status: string, unavailable: boolean) {
  if (unavailable) return { state: "critical" as const, label: "86'd — unavailable", badge: "critical" as const, text: "86'd" };
  if (status === "published") return { state: "fresh" as const, label: "Live", badge: "live" as const, text: "live" };
  if (status === "archived") return { state: "archived" as const, label: "Archived", badge: "neutral" as const, text: "archived" };
  return { state: "idle" as const, label: "Draft — not live", badge: "neutral" as const, text: "draft" };
}

export default async function MenuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { categories, items, unavailableIds } = await queryAsCurrentUser(async (tx) => {
    const categories = await tx
      .select({ id: schema.categories.id, name: schema.categories.name })
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
      .from(schema.menuItems)
      .orderBy(schema.menuItems.name);

    // An item is 86'd somewhere if its most recent availability override
    // says so. Shown as a flag on the list; the per-store detail lives on
    // the item page (a chain item can be 86'd at one outlet and fine at
    // another — the list can't say "86'd" without saying where, so it says
    // "86'd somewhere" and the detail page tells you where).
    const offRows = await tx
      .select({ menuItemId: schema.menuItemOverrides.menuItemId })
      .from(schema.menuItemOverrides)
      .where(eq(schema.menuItemOverrides.isAvailable, false));

    return { categories, items, unavailableIds: new Set(offRows.map((r) => r.menuItemId)) };
  });

  const byCategory = new Map<string | null, typeof items>();
  for (const item of items) {
    const key = item.categoryId;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(item);
  }

  const groups = [
    ...categories.map((c) => ({ id: c.id, name: c.name, items: byCategory.get(c.id) ?? [] })),
    ...(byCategory.get(null)?.length ? [{ id: "__none", name: "Uncategorised", items: byCategory.get(null)! }] : []),
  ];

  const liveCount = items.filter((i) => i.status === "published" && !unavailableIds.has(i.id)).length;

  return (
    <ConsoleShell email={user?.email}>
      <PageHeader
        title="Menu"
        subtitle={`${items.length} items across ${categories.length} categories · ${liveCount} live right now. The rail on each row is its state — green is live, red hatched is 86'd, grey is draft.`}
        actions={
          <Link href="/menu/new">
            <Button variant="primary">New item</Button>
          </Link>
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {groups.map((group, gi) => (
          <Animate key={group.id} delayIndex={gi}>
            <Card padded={false}>
              <CardHeader title={group.name} count={`${group.items.length}`} />
              {group.items.map((item) => {
                const rail = railFor(item.status, unavailableIds.has(item.id));
                return (
                  <DataRow
                    key={item.id}
                    href={`/menu/${item.id}`}
                    railState={rail.state}
                    railLabel={rail.label}
                    muted={item.status === "archived"}
                    label={item.name}
                    trailing={
                      <>
                        <Badge tone={rail.badge}>{rail.text}</Badge>
                        <TabularNumber>{rupees(item.basePricePaise)}</TabularNumber>
                      </>
                    }
                  />
                );
              })}
              {group.items.length === 0 && (
                <p style={{ padding: "var(--space-2)", margin: 0, fontSize: "var(--text-sm)", color: "var(--chalk-400)" }}>
                  Nothing in this category yet.
                </p>
              )}
            </Card>
          </Animate>
        ))}

        {items.length === 0 && (
          <Card>
            <p style={{ margin: 0, color: "var(--chalk-400)" }}>
              No menu items yet. Create the first one to get started.
            </p>
          </Card>
        )}
      </div>
    </ConsoleShell>
  );
}
