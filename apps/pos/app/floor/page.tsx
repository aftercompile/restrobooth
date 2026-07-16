import { PosShell } from "../PosShell";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { getFloor } from "./queries";
import { FloorMap } from "./FloorMap";

export default async function FloorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const tables = await queryAsCurrentUser((tx) => getFloor(tx));

  return (
    <PosShell email={user?.email}>
      <FloorMap tables={tables} />
    </PosShell>
  );
}
