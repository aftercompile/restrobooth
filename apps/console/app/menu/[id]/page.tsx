import { notFound } from "next/navigation";
import Link from "next/link";
import { eq, schema } from "@restrobooth/db";
import { Animate, PageHeader } from "@restrobooth/ui";
import { queryAsCurrentUser } from "../../../lib/db";
import { createClient } from "../../../lib/supabase/server";
import { ConsoleShell } from "../../ConsoleShell";
import { ItemDetailsForm } from "./ItemDetailsForm";
import { OptionsManager } from "./OptionsManager";
import { OverrideActions } from "./OverrideActions";
import { AuditTrail } from "./AuditTrail";
import styles from "./page.module.css";

export default async function MenuItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
  const eightySixed = overrides.some((o) => o.isAvailable === false);

  return (
    <ConsoleShell email={user?.email}>
      <Link href="/menu" className={styles.back}>
        ← All items
      </Link>

      <PageHeader
        title={item.name}
        subtitle={
          item.status === "published"
            ? eightySixed
              ? "Live, but 86'd at one or more stores."
              : "Live at every store that carries this brand."
            : `Status: ${item.status}. Not visible to guests.`
        }
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", maxWidth: 720 }}>
        <Animate delayIndex={0}>
          <Section title="Details" hint="The brand-level definition. Every store inherits this unless overridden below.">
            <ItemDetailsForm item={item} taxClasses={taxClasses} />
          </Section>
        </Animate>

        <Animate delayIndex={1}>
          <Section
            title="Variants & add-ons"
            hint="A variant replaces the base price (Half / Full). An add-on adds to it (Extra cheese)."
          >
            <OptionsManager itemId={item.id} optionGroups={optionGroups} optionItems={optionItems} />
          </Section>
        </Animate>

        <Animate delayIndex={2}>
          <Section
            title="Store pricing & availability"
            hint="Price and availability resolve independently — 86'ing an item never erases its price override."
          >
            <OverrideActions itemId={item.id} stores={stores} overrides={overrides} />
          </Section>
        </Animate>

        <Animate delayIndex={3}>
          <Section title="Audit trail" hint="Every price change and 86, who did it, and when.">
            <AuditTrail rows={auditRows} />
          </Section>
        </Animate>
      </div>
    </ConsoleShell>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {hint && <p className={styles.sectionHint}>{hint}</p>}
      {children}
    </section>
  );
}
