import { NextResponse, type NextRequest } from "next/server";
import { supabaseSsrProxy } from "@/lib/supabase/ssr";
import { forwardedIdentity } from "@/lib/identity";

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
 *
 * IT ALSO FORWARDS WHO IT VERIFIED. The `getUser()` below is a network call to
 * the Supabase Auth server, and every route handler used to make the same call
 * again for the same answer — two auth round trips on every single write
 * (feature-brief-write-path-latency-and-in-flight-feedback.md, Finding 1). The
 * result now travels downstream on a header instead. `lib/identity.ts` owns that
 * header and, critically, strips any client-supplied value before setting its
 * own: this is the only place one is ever set.
 */
const PUBLIC_PAGES = new Set(["/login"]);

/**
 * Owner-email allowlist (ADR-0006 Amendment 1).
 *
 * Neither the magic-link flow nor Supabase Auth on its own restricts sign-in to
 * one person — any email that completes the flow gets a valid session, and RLS's
 * `auth.uid() IS NOT NULL` admits any authenticated user to the same rows, since
 * no table has an owner column (project-spec Gap 22). This is the one place that
 * actually enforces "single user": a session whose email doesn't match is treated
 * identically to signed-out, everywhere downstream — no page access, no forwarded
 * identity, so `auth-server.ts` and RLS never even see it.
 *
 * Lives here rather than only in `/auth/callback` because this runs on every
 * request regardless of how the session was established (today's magic link, a
 * future OAuth swap, or a stray Supabase-dashboard-created account) — one check
 * instead of one per auth method.
 */
function authorizedUserId(user: { id: string; email?: string } | null): string | null {
  const authorizedEmail = process.env.AUTHORIZED_EMAIL;
  if (!authorizedEmail) {
    throw new Error("Missing AUTHORIZED_EMAIL — see .env.example");
  }
  if (user === null || user.email !== authorizedEmail) return null;
  return user.id;
}

export async function proxy(request: NextRequest): Promise<Response> {
  const { supabase, finalize } = supabaseSsrProxy(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = authorizedUserId(user);

  const { pathname } = request.nextUrl;
  const isApiOrAuthRoute = pathname.startsWith("/api/") || pathname.startsWith("/auth/");

  if (userId === null && !isApiOrAuthRoute && !PUBLIC_PAGES.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Note this runs for a signed-OUT `/api/*` caller too, and passes `null` — which
  // is what strips a forged header off an unauthenticated request rather than
  // letting it through untouched. Handlers still answer 401; they just do it from
  // the absence of a header instead of a second round trip. A signed-in-but-wrong-
  // email caller takes the same path: `userId` is null for them too.
  return finalize(forwardedIdentity(request.headers, userId));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)"],
};
