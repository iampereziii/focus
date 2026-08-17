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
  }

  return NextResponse.redirect(new URL("/login", url.origin));
}
