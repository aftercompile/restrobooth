import { redirect } from "next/navigation";

export default function Home() {
  // The floor map is the POS's home surface. Unauthenticated requests
  // never reach here (the middleware redirects to /login first).
  redirect("/floor");
}
