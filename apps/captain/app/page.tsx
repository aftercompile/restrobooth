import { redirect } from "next/navigation";

export default function Home() {
  // The floor list is the captain app's home surface. Unauthenticated
  // requests never reach here (the middleware redirects to /login first).
  redirect("/floor");
}
