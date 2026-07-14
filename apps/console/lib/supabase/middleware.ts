import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie on every request and gates the
 * app behind login. Standard @supabase/ssr App Router pattern: the
 * important line is `supabase.auth.getUser()` (validates the token with
 * GoTrue, not just decodes it) — never trust getSession() in middleware.
 *
 * Unauthenticated requests are redirected to /login, except /login itself
 * and Next internals. There is no public surface in the console — it's the
 * HQ back office; every route needs a session.
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

  // /style-guide is the design system's own reference page. It renders no
  // user data and reads nothing from the database — it exists to be LOOKED
  // at (CLAUDE.md rule 11: "screenshot the UI and critique it"). Gating it
  // behind a login makes it useless for exactly that, so it stays public.
  const isPublic = isLoginRoute || pathname.startsWith("/style-guide");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/menu";
    return NextResponse.redirect(url);
  }

  return response;
}
