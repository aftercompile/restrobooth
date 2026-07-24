import { redirect } from "next/navigation";
import { getGuestContext } from "../../lib/guest-context";
import { getBoothMenu, type BoothMenuItem } from "../../lib/menu-queries";
import { getGuestOrderStatus } from "../../lib/order-queries";
import { BoothShell } from "../BoothShell";
import { BoothHostIntake } from "./BoothHostIntake";
import { MenuBrowser } from "./MenuBrowser";

export default async function MenuPage() {
  const guest = await getGuestContext();
  if (!guest) redirect("/invalid?message=Your session has ended — please rescan the code on your table.");

  const [items, status] = await Promise.all([getBoothMenu(guest.storeId), getGuestOrderStatus(guest.guestSessionId)]);
  const cartItems = status.items.filter((i) => i.status === "pending");

  const groups = new Map<string, BoothMenuItem[]>();
  for (const item of items) {
    const key = item.categoryName ?? "Menu";
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  return (
    <BoothShell tableLabel={guest.tableLabel} brandName={guest.brandName} waiterCalled={guest.waiterCalled}>
      {items.length === 0 ? (
        <p>Nothing on the menu right now — please ask a staff member.</p>
      ) : (
        <>
          <BoothHostIntake />
          <MenuBrowser groups={Array.from(groups.entries())} cartItems={cartItems} />
        </>
      )}
    </BoothShell>
  );
}
