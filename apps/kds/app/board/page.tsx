import { KdsShell } from "../KdsShell";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { getActiveTickets } from "./queries";
import { TicketBoard } from "./TicketBoard";

export default async function BoardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tickets = await queryAsCurrentUser((tx) => getActiveTickets(tx));
  const multiBrandOutlet = new Set(tickets.map((t) => t.brandName)).size > 1;

  return (
    <KdsShell email={user?.email}>
      <TicketBoard tickets={tickets} multiBrandOutlet={multiBrandOutlet} />
    </KdsShell>
  );
}
