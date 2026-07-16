import { PosShell } from "../PosShell";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { getDayStatuses } from "./queries";
import { DayList } from "./DayList";

export default async function DayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const days = await queryAsCurrentUser((tx) => getDayStatuses(tx));

  return (
    <PosShell email={user?.email}>
      <h1>Business day</h1>
      <DayList days={days} />
    </PosShell>
  );
}
