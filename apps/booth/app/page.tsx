import { redirect } from "next/navigation";
import { getGuestContext } from "../lib/guest-context";
import { getGuestOrderStatus } from "../lib/order-queries";
import { BoothShell } from "./BoothShell";
import { BoothPoll } from "./BoothPoll";
import { OrderStatusBoard } from "./OrderStatusBoard";
import { CartSection, EmptyOrderState } from "./CartSection";

/** Where a valid scan lands (apps/booth/app/t/[token]/route.ts redirects
 *  here) and where a returning guest's browser reopens to — split into
 *  the editable cart (pending order_items — Place order fires them) above
 *  the live kitchen status board (fired/served — the signature split-flap
 *  surface) below it. */
export default async function HomePage() {
  const guest = await getGuestContext();
  if (!guest) redirect("/invalid?message=Your session has ended — please rescan the code on your table.");

  const status = await getGuestOrderStatus(guest.guestSessionId);
  const cartItems = status.items.filter((i) => i.status === "pending");
  const liveItems = status.items.filter((i) => i.status !== "pending");

  return (
    <BoothShell tableLabel={guest.tableLabel} brandName={guest.brandName}>
      <BoothPoll />
      <h1 className="rb-display" style={{ fontSize: "var(--text-xl)", marginBottom: "var(--space-2)" }}>
        Your order
      </h1>
      {cartItems.length === 0 && liveItems.length === 0 && <EmptyOrderState />}
      {cartItems.length > 0 && (
        <div style={{ marginBottom: "var(--space-3)" }}>
          <CartSection items={cartItems} />
        </div>
      )}
      <OrderStatusBoard items={liveItems} />
    </BoothShell>
  );
}
