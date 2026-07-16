import { CaptainShell } from "../CaptainShell";
import { queryAsCurrentUser } from "../../lib/db";
import { getFloor } from "./queries";
import { FloorList } from "./FloorList";

export default async function FloorPage() {
  const tables = await queryAsCurrentUser((tx) => getFloor(tx));

  return (
    <CaptainShell>
      <FloorList tables={tables} />
    </CaptainShell>
  );
}
