import { notFound } from "next/navigation";
import { PosShell } from "../../PosShell";
import { queryAsCurrentUser } from "../../../lib/db";
import { createClient } from "../../../lib/supabase/server";
import { getSessionDetail, getOpenOrder, getKotsForSession, getOrderableMenu } from "./queries";
import { getOpenSessionsForStore } from "../queries";
import { OrderPad } from "./OrderPad";

export default async function OrderPadPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const data = await queryAsCurrentUser(async (tx) => {
    const session = await getSessionDetail(tx, sessionId);
    if (!session) return null;
    // Sequential, not Promise.all: these all share the same transaction-
    // bound client, and a single pg connection can't pipeline concurrent
    // queries — Promise.all here silently serialised anyway (with a
    // deprecation warning), so this is a correctness fix, not just style.
    const order = await getOpenOrder(tx, sessionId);
    const kots = await getKotsForSession(tx, sessionId);
    const menu = await getOrderableMenu(tx, session.storeId, "dinein");
    const mergeTargets = await getOpenSessionsForStore(tx, session.storeId, sessionId);
    return { session, order, kots, menu, mergeTargets };
  });

  if (!data) notFound();

  return (
    <PosShell email={user?.email}>
      <OrderPad
        session={data.session}
        order={data.order}
        kots={data.kots}
        menu={data.menu}
        mergeTargets={data.mergeTargets}
      />
    </PosShell>
  );
}
