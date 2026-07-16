import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and gates the
 * app behind login. Same @supabase/ssr pattern as apps/pos — see that
 * file's comment for why `getUser()` and not `getSession()`.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLoginRoute = pathname.startsWith("/login");
  // The PWA manifest and icons must be reachable without a session, or
  // "Add to Home Screen" (OPEN-DECISIONS.md §10.7's install flow) never
  // gets to read them.
  const isPublic = isLoginRoute || pathname.startsWith("/manifest.webmanifest");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/floor";
    return NextResponse.redirect(url);
  }

  return response;
}
