import { redirect } from "next/navigation";

export default function Home() {
  // The console has no distinct landing yet — the menu is the home surface.
  // Unauthenticated requests never reach here (middleware redirects to
  // /login first).
  redirect("/menu");
}
