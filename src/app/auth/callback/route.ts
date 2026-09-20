import { NextResponse } from "next/server";
import { exchangeCodeForSession } from "@/lib/store/auth-server";

/**
 * `/auth/callback` — where the magic link lands.
 *
 * `@supabase/ssr`'s browser client uses PKCE, so the emailed link carries a
 * `code`, not a URL-hash token — and PKCE's whole point is that the exchange
 * happens server-side, where the cookie can actually be set (a Server
 * Component's render can't write one; a Route Handler can). This is the one
 * round trip magic-link sign-in gains, and it happens once per login, not per
 * session.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code !== null) {
    const error = await exchangeCodeForSession(code);
    if (error === null) return NextResponse.redirect(new URL(next, url.origin));

    // TEMPORARY diagnostic (2026-09-20) — exchangeCodeForSession's real error was
    // previously discarded here, so a failed sign-in was indistinguishable from a
    // typo'd URL. Logged server-side and surfaced on /login so the actual cause
    // (expired code, already-used code, verifier mismatch, etc.) is visible instead
    // of a silent redirect loop. Remove once the mobile sign-in failure is diagnosed.
    console.error("[auth/callback] exchangeCodeForSession failed:", error);
    const loginUrl = new URL("/login", url.origin);
    loginUrl.searchParams.set("error", error);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL("/login", url.origin));
}
