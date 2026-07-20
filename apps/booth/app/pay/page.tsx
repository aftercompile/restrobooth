import { redirect } from "next/navigation";
import { getGuestContext } from "../../lib/guest-context";
import { BoothShell } from "../BoothShell";
import { PayPanel } from "./PayPanel";

/** allowClosed: true — the mock gateway closes the session as PART of
 *  paying, and this is the one page a guest is still legitimately on
 *  right after that happens (a refresh mid-flow, or just staying put to
 *  see the "thanks" screen). Every other Booth page keeps the default
 *  reject (getGuestContext's own comment). */
export default async function PayPage() {
  const guest = await getGuestContext({ allowClosed: true });
  if (!guest) redirect("/invalid?message=Your session has ended — please rescan the code on your table.");

  return (
    <BoothShell tableLabel={guest.tableLabel} brandName={guest.brandName} waiterCalled={guest.waiterCalled}>
      <PayPanel upiAvailable={guest.upiAvailable} />
    </BoothShell>
  );
}
