import { notFound } from "next/navigation";
import { PosShell } from "../../PosShell";
import { queryAsCurrentUser } from "../../../lib/db";
import { createClient } from "../../../lib/supabase/server";
import { getSessionDetail, getOpenOrder, getKotsForSession, getOrderableMenu, getOfflineSeatContext, type SessionDetail } from "./queries";
import { getOpenSessionsForStore } from "../queries";
import { getSessionBills } from "./bill/queries";
import { TableWorkspace } from "./TableWorkspace";

export default async function OrderPadPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ outletId?: string; tableId?: string; covers?: string }>;
}) {
  const { sessionId } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const data = await queryAsCurrentUser(async (tx) => {
    const session = await getSessionDetail(tx, sessionId);
    if (session) {
      // Sequential, not Promise.all: these all share the same transaction-
      // bound client, and a single pg connection can't pipeline concurrent
      // queries — Promise.all here silently serialised anyway (with a
      // deprecation warning), so this is a correctness fix, not just style.
      const order = await getOpenOrder(tx, sessionId);
      const kots = await getKotsForSession(tx, sessionId);
      const menu = await getOrderableMenu(tx, session.storeId, "dinein");
      const mergeTargets = await getOpenSessionsForStore(tx, session.storeId, sessionId);
      const bills = await getSessionBills(tx, sessionId);
      return { session, order, kots, menu, mergeTargets, bills };
    }

    // No server row yet — this may be a table seated while offline
    // (ADR-0004: `SeatTableDialog` navigates here immediately, with the
    // context needed to resolve the store/menu even before the
    // `seatTable` mutation itself has synced). Render a working order
    // pad from that context rather than a 404; `notFound()` below is
    // still correct for a genuinely bad sessionId.
    if (!sp.outletId || !sp.tableId) return null;
    const ctx = await getOfflineSeatContext(tx, sp.outletId, sp.tableId);
    if (!ctx) return null;

    const menu = await getOrderableMenu(tx, ctx.storeId, "dinein");
    const fallbackSession: SessionDetail = {
      sessionId,
      status: "open",
      storeId: ctx.storeId,
      outletId: sp.outletId,
      businessDayId: "",
      covers: Number(sp.covers) || 1,
      openedAt: new Date().toISOString(),
      tableLabels: ctx.tableLabel,
      brandName: ctx.brandName,
      // Genuinely unknown until the queued seatTable mutation syncs and
      // this page re-fetches the real row — not carried through the URL
      // the way `covers` is, to avoid URL-encoding free-text guest notes.
      // Self-heals within the same drain window everything else here does.
      guestName: null,
      guestPhone: null,
      guestNotes: null,
    };
    return { session: fallbackSession, order: null, kots: [], menu, mergeTargets: [], bills: [] };
  });

  if (!data) notFound();

  return (
    <PosShell email={user?.email}>
      <TableWorkspace
        session={data.session}
        order={data.order}
        kots={data.kots}
        menu={data.menu}
        mergeTargets={data.mergeTargets}
        bills={data.bills}
      />
    </PosShell>
  );
}
