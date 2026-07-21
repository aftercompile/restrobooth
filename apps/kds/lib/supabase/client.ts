import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for Client Components (the Realtime subscription in
 *  Slice 4, and the login form's submit path). */
export function createClient() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  // supabase-js only wires realtime.setAuth() automatically on the
  // SIGNED_IN / TOKEN_REFRESHED auth events — never on INITIAL_SESSION,
  // the event fired when a client hydrates a session that was already
  // authenticated server-side, which is every page here (auth happens via
  // the SSR cookie, never a client-side sign-in). Left unset, Realtime's
  // RLS-scoped postgres_changes silently evaluates every subscription as
  // the anon role: the socket stays healthy, "Subscribed to PostgreSQL"
  // and all, but nothing is ever pushed, because anon can see none of
  // these rows under RLS. This is what made the board never update
  // without a manual refresh even after 0030 fixed the partition-root gap.
  supabase.auth.onAuthStateChange((_event, session) => {
    void supabase.realtime.setAuth(session?.access_token ?? null);
  });

  return supabase;
}
