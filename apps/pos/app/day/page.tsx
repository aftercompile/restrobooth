import { PosShell } from "../PosShell";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { getDayStatuses } from "./queries";
import { DayList } from "./DayList";
import styles from "./page.module.css";

export default async function DayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const days = await queryAsCurrentUser((tx) => getDayStatuses(tx));

  return (
    <PosShell email={user?.email}>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>Business day</h1>
        <p className={styles.pageSub}>Open a day before billing; close it once every session and bill is resolved.</p>
      </div>
      <DayList days={days} />
    </PosShell>
  );
}
