import { KdsShell } from "../KdsShell";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { getActiveTickets, getMyOutletIds, getRecentlyBumpedTickets } from "./queries";
import { TicketBoard } from "./TicketBoard";
import { RealtimeSync } from "./RealtimeSync";

export default async function BoardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { tickets, recentlyBumped, outletIds } = await queryAsCurrentUser(async (tx) => ({
    tickets: await getActiveTickets(tx),
    recentlyBumped: await getRecentlyBumpedTickets(tx),
    outletIds: await getMyOutletIds(tx),
  }));
  const multiBrandOutlet = new Set([...tickets, ...recentlyBumped].map((t) => t.brandName)).size > 1;

  return (
    <KdsShell email={user?.email}>
      <RealtimeSync outletIds={outletIds} />
      <TicketBoard tickets={tickets} recentlyBumped={recentlyBumped} multiBrandOutlet={multiBrandOutlet} />
    </KdsShell>
  );
}
