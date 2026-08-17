import { NextResponse, type NextRequest } from "next/server";
import { supabaseSsrProxy } from "@/lib/supabase/ssr";

/**
 * Refreshes the Supabase session cookie on every request and redirects
 * unauthenticated PAGE loads to `/login` server-side — replacing the client-side
 * 401 → `router.replace("/login")` catch that used to live in `(app)/layout.tsx`
 * (feature-brief-cookie-session-ssr-swap.md).
 *
 * `/api/*` routes are exempt from the redirect: they answer 401 with the
 * `{ error }` envelope via `lib/store/auth-server.ts`, not a redirect, so a
 * fetch() call must keep getting JSON back. They still get their cookie
 * refreshed here, same as every other route.
 */
const PUBLIC_PAGES = new Set(["/login"]);

export async function proxy(request: NextRequest): Promise<Response> {
  const { supabase, response } = supabaseSsrProxy(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isApiOrAuthRoute = pathname.startsWith("/api/") || pathname.startsWith("/auth/");

  if (user === null && !isApiOrAuthRoute && !PUBLIC_PAGES.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)"],
};
