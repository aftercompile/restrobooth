import { redirect } from "next/navigation";

export default function Home() {
  // The ticket board is the KDS's home surface. Unauthenticated requests
  // never reach here (the proxy redirects to /login first).
  redirect("/board");
}
