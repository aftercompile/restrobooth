import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Actions, and Route
 * Handlers. Reads/writes the session cookie via next/headers. The cookie
 * write in a Server Component throws (RSCs can't set cookies) — expected
 * and swallowed; the proxy is what actually refreshes the cookie on every
 * request (see ../../proxy.ts). Same pattern as apps/pos.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — safe to ignore, the
            // proxy refreshes the session cookie instead.
          }
        },
      },
    },
  );
}
