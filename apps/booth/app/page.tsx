import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getUpsellSuggestions } from "@restrobooth/ai";
import { getGuestContext } from "../lib/guest-context";
import { getGuestOrderStatus } from "../lib/order-queries";
import { getBoothMenu } from "../lib/menu-queries";
import { getDb } from "../lib/db";
import { BoothShell } from "./BoothShell";
import { BoothPoll } from "./BoothPoll";
import { CartSection } from "./CartSection";
import { RequestBillButton } from "./RequestBillButton";
import { UpsellRail } from "./UpsellRail";
import { Welcome } from "./Welcome";

// The only component on this page that imports framer-motion — dynamic()
// still renders it server-side (the split-flap board's real content is in
// the first response either way), but code-splits the CLIENT bundle out
// of the page's initial JS. Measured with Lighthouse under 4G+CPU
// throttling: a first scan with an empty cart was paying framer-motion's
// full parse/hydrate cost for a component that renders null. See
// DECISIONS.md's Phase 5 LCP entry for the before/after numbers.
const OrderStatusBoard = dynamic(() => import("./OrderStatusBoard").then((m) => m.OrderStatusBoard));

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
  const isFreshGuest = cartItems.length === 0 && liveItems.length === 0;

  // Every order_item already in the cart or fired/served counts as "the
  // basket so far" — not just what's still pending — so the suggestion
  // stays relevant even after a first round has already gone to the
  // kitchen (RESTROBOOTH_BRIEF.md §5E: "goes well with" the order, not
  // just the not-yet-fired remainder of it).
  const upsell =
    cartItems.length > 0
      ? await getUpsellSuggestions(getDb(), {
          storeId: guest.storeId,
          outletId: guest.outletId,
          cartMenuItemIds: status.items.map((i) => i.menuItemId),
        })
      : null;

  // Only fetched for a fresh guest (Welcome's "Popular today" teaser) —
  // no point paying for this query once there's a real cart/board to show
  // instead.
  const popularItems = isFreshGuest ? (await getBoothMenu(guest.storeId)).filter((i) => i.isPopular).slice(0, 3) : [];

  return (
    <BoothShell tableLabel={guest.tableLabel} brandName={guest.brandName} waiterCalled={guest.waiterCalled}>
      <BoothPoll />
      {isFreshGuest ? (
        <Welcome brandName={guest.brandName} popularItems={popularItems} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-2)" }}>
            <h1 className="rb-display" style={{ fontSize: "var(--text-xl)", margin: 0 }}>
              Your order
            </h1>
            {/* The header's old Menu tab is gone — this is the order screen's
                own way back, so dropping that tab never became a dead end. */}
            <Link href="/menu" style={{ color: "var(--enamel-700)", fontWeight: 600, fontSize: "var(--text-sm)" }}>
              + Add more items
            </Link>
          </div>
          {cartItems.length > 0 && (
            <div style={{ marginBottom: "var(--space-3)" }}>
              <CartSection items={cartItems} />
              {upsell && <UpsellRail result={upsell} />}
            </div>
          )}
          <OrderStatusBoard items={liveItems} />
          {(guest.sessionStatus === "dining" || guest.sessionStatus === "bill_requested" || guest.sessionStatus === "settling") && (
            <RequestBillButton sessionStatus={guest.sessionStatus} />
          )}
        </>
      )}
    </BoothShell>
  );
}
