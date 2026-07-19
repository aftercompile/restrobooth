import { redirect } from "next/navigation";
import { Animate, Card, CardHeader, DataRow, formatPaiseAsRupees, TabularNumber } from "@restrobooth/ui";
import { getGuestContext } from "../../lib/guest-context";
import { getBoothMenu } from "../../lib/menu-queries";
import { BoothShell } from "../BoothShell";

/** Browse-only this slice — no add-to-cart control. Self-service ordering
 *  (Slice 2b) needs its own write path + RLS policy + adversarial tests;
 *  shipping a button with nothing to submit to would be UI for a feature
 *  that doesn't exist yet (CLAUDE.md's standing rule). */
export default async function MenuPage() {
  const guest = await getGuestContext();
  if (!guest) redirect("/invalid?message=Your session has ended — please rescan the code on your table.");

  const items = await getBoothMenu(guest.storeId);

  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.categoryName ?? "Menu";
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  return (
    <BoothShell tableLabel={guest.tableLabel} brandName={guest.brandName}>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        {items.length === 0 && <p>Nothing on the menu right now — please ask a staff member.</p>}
        {Array.from(groups.entries()).map(([categoryName, categoryItems], gi) => (
          <Animate key={categoryName} delayIndex={gi}>
            <Card padded={false}>
              <CardHeader title={categoryName} count={categoryItems.length} />
              {categoryItems.map((item) => (
                <DataRow
                  key={item.menuItemId}
                  label={item.name}
                  trailing={<TabularNumber>₹{formatPaiseAsRupees(BigInt(item.pricePaise))}</TabularNumber>}
                />
              ))}
            </Card>
          </Animate>
        ))}
      </div>
    </BoothShell>
  );
}
