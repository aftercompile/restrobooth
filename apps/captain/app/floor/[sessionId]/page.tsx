import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CaptainShell } from "../../CaptainShell";
import { queryAsCurrentUser } from "../../../lib/db";
import { getSessionDetail, getOpenOrder, getKotsForSession, getOrderableMenu } from "./queries";
import { OrderScreen } from "./OrderScreen";
import { UpsellSection, UpsellSectionSkeleton } from "./UpsellSection";

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

  // Suspense-streamed (see UpsellSection.tsx) so the shared 9s AI budget
  // (packages/ai/src/upsell.ts, raised from 1200ms alongside the Booth
  // Host — owner decision, 2026-07-24) never blocks the order/menu/KOT
  // content above it, which is already ready. Outside queryAsCurrentUser's
  // RLS-scoped tx on purpose — getUpsellSuggestions needs its own
  // budget/cache transactions (packages/ai's own contract), not a nested
  // transaction on an already-scoped one.
  const upsellSlot =
    data.order && data.order.items.length > 0 ? (
      <Suspense fallback={<UpsellSectionSkeleton />}>
        <UpsellSection
          sessionId={data.session.sessionId}
          storeId={data.session.storeId}
          outletId={data.session.outletId}
          cartMenuItemIds={data.order.items.map((i) => i.menuItemId)}
        />
      </Suspense>
    ) : null;

  return (
    <CaptainShell>
      <OrderScreen session={data.session} order={data.order} kots={data.kots} menu={data.menu} upsellSlot={upsellSlot} />
    </CaptainShell>
  );
}
