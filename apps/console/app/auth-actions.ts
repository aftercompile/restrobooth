"use server";

import { redirect } from "next/navigation";
import { createClient } from "../lib/supabase/server";

/** Shell-wide sign-out. Lives here rather than under /menu because it's
 *  chrome, not a menu concern. */
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
