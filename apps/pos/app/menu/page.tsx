import { PosShell } from "../PosShell";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { getMenuOverview } from "./queries";
import { MenuBrowser } from "./MenuBrowser";

export default async function MenuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const items = await queryAsCurrentUser((tx) => getMenuOverview(tx));

  return (
    <PosShell email={user?.email}>
      <MenuBrowser items={items} />
    </PosShell>
  );
}
