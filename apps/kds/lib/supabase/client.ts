import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for Client Components (the Realtime subscription in
 *  Slice 4, and the login form's submit path). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
