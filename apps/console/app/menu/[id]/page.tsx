import { notFound } from "next/navigation";
import { eq, schema } from "@restrobooth/db";
import { queryAsCurrentUser } from "../../../lib/db";
import { ItemDetailsForm } from "./ItemDetailsForm";
import { OptionsManager } from "./OptionsManager";
import { OverrideActions } from "./OverrideActions";
import { AuditTrail } from "./AuditTrail";

export default async function MenuItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await queryAsCurrentUser(async (tx) => {
    const [item] = await tx.select().from(schema.menuItems).where(eq(schema.menuItems.id, id));
    if (!item) return null;

    const taxClasses = await tx
      .select({ id: schema.taxClasses.id, code: schema.taxClasses.code, rateBps: schema.taxClasses.rateBps })
      .from(schema.taxClasses);
    const optionGroups = await tx
      .select()
      .from(schema.optionGroups)
      .where(eq(schema.optionGroups.menuItemId, id))
      .orderBy(schema.optionGroups.sortOrder);
    // One query per group rather than an IN-list — option counts per item
    // are small (a handful of groups), so this N+1 isn't the kind of thing
    // worth optimising in Phase 2.
    const optionGroupIds = optionGroups.map((g) => g.id);
    const optionItems = optionGroupIds.length
      ? (
          await Promise.all(
            optionGroupIds.map((gid) => tx.select().from(schema.optionItems).where(eq(schema.optionItems.optionGroupId, gid))),
          )
        ).flat()
      : [];

    const stores = await tx
      .select({ id: schema.stores.id, outletName: schema.outlets.name })
      .from(schema.stores)
      .innerJoin(schema.outlets, eq(schema.outlets.id, schema.stores.outletId))
      .where(eq(schema.stores.brandId, item.brandId));

    const overrides = await tx
      .select()
      .from(schema.menuItemOverrides)
      .where(eq(schema.menuItemOverrides.menuItemId, id))
      .orderBy(schema.menuItemOverrides.publishedAt);

    const auditRows = await tx
      .select()
      .from(schema.menuAuditLog)
      .where(eq(schema.menuAuditLog.entityId, id))
      .orderBy(schema.menuAuditLog.createdAt);

    return { item, taxClasses, optionGroups, optionItems, stores, overrides, auditRows };
  });

  if (!data) notFound();
  const { item, taxClasses, optionGroups, optionItems, stores, overrides, auditRows } = data;

  return (
    <main style={{ padding: "var(--space-3)", maxWidth: 640, display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>{item.name}</h1>

      <ItemDetailsForm item={item} taxClasses={taxClasses} />

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-2)" }}>Variants &amp; add-ons</h2>
        <OptionsManager itemId={item.id} optionGroups={optionGroups} optionItems={optionItems} />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-2)" }}>Store pricing &amp; availability</h2>
        <OverrideActions itemId={item.id} stores={stores} overrides={overrides} />
      </section>

      <section>
        <h2 style={{ fontSize: "var(--text-lg)", marginBottom: "var(--space-2)" }}>Audit trail</h2>
        <AuditTrail rows={auditRows} />
      </section>
    </main>
  );
}
