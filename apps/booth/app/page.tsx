import { redirect } from "next/navigation";
import { getGuestContext } from "../lib/guest-context";
import { getGuestOrderStatus } from "../lib/order-queries";
import { BoothShell } from "./BoothShell";
import { BoothPoll } from "./BoothPoll";
import { OrderStatusBoard } from "./OrderStatusBoard";

/** Where a valid scan lands (apps/booth/app/t/[token]/route.ts redirects
 *  here) and where a returning guest's browser reopens to — the live
 *  status board, this app's signature surface. */
export default async function HomePage() {
  const guest = await getGuestContext();
  if (!guest) redirect("/invalid?message=Your session has ended — please rescan the code on your table.");

  const status = await getGuestOrderStatus(guest.guestSessionId);

  return (
    <BoothShell tableLabel={guest.tableLabel} brandName={guest.brandName}>
      <BoothPoll />
      <h1 className="rb-display" style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-2)" }}>
        Your order
      </h1>
      <OrderStatusBoard items={status.items} />
    </BoothShell>
  );
}
