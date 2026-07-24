import { notFound } from "next/navigation";
import { getUpsellSuggestions, type UpsellResult } from "@restrobooth/ai";
import { CaptainShell } from "../../CaptainShell";
import { queryAsCurrentUser, getDb } from "../../../lib/db";
import { getSessionDetail, getOpenOrder, getKotsForSession, getOrderableMenu } from "./queries";
import { OrderScreen } from "./OrderScreen";

export default async function OrderPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  const data = await queryAsCurrentUser(async (tx) => {
    const session = await getSessionDetail(tx, sessionId);
    if (!session) return null;
    // Sequential, not Promise.all — see apps/pos's identical fix, same
    // reason (one pg connection can't pipeline concurrent queries).
    const order = await getOpenOrder(tx, sessionId);
    const kots = await getKotsForSession(tx, sessionId);
    const menu = await getOrderableMenu(tx, session.storeId, "dinein");
    return { session, order, kots, menu };
  });

  if (!data) notFound();

  // Outside queryAsCurrentUser's RLS-scoped tx on purpose — getUpsellSuggestions
  // needs its own budget/cache transactions (packages/ai's own contract,
  // same as the Booth Host), not a nested transaction on an already-scoped one.
  const upsell: UpsellResult | null =
    data.order && data.order.items.length > 0
      ? await getUpsellSuggestions(getDb(), {
          storeId: data.session.storeId,
          outletId: data.session.outletId,
          cartMenuItemIds: data.order.items.map((i) => i.menuItemId),
        })
      : null;

  return (
    <CaptainShell>
      <OrderScreen session={data.session} order={data.order} kots={data.kots} menu={data.menu} upsell={upsell} />
    </CaptainShell>
  );
}
