import "server-only";

/**
 * Server-side auth for route handlers, Server Components, and the magic-link
 * callback.
 *
 * Single user, magic link, no roles (spec NFR § Authentication). Protected
 * surface is everything except `/login`.
 *
 * Cookie-based since feature-brief-cookie-session-ssr-swap.md — the browser's
 * session lives in a cookie (`lib/supabase/browser.ts`'s `@supabase/ssr` client),
 * `src/proxy.ts` refreshes it every request, and this reads it back. There
 * is no bearer-token fallback: no workflow calls `/api/*` from outside the
 * browser, so there is nothing to preserve (Risk 3, resolved 2026-08-18).
 *
 * It lives in `lib/store/` because that is the only folder permitted to touch a
 * Supabase client (eslint guardrail (a)) — auth is not data access, but the
 * guardrail is deliberately absolute.
 *
 * Note the division of labour with RLS: the service-role client used everywhere
 * else BYPASSES RLS, so this function is what actually gates the API. RLS exists
 * so the anon key the browser holds reads nothing while signed out — belt and
 * braces, each covering what the other cannot.
 */

import { headers } from "next/headers";
import { supabaseSsr } from "@/lib/supabase/ssr";
import { IDENTITY_HEADER } from "@/lib/identity";

/**
 * Returns the user id, or null when the caller is not signed in.
 *
 * TWO SOURCES, IN THIS ORDER, AND THE ORDER IS THE WHOLE OPTIMISATION:
 *
 *   1. The identity `src/proxy.ts` already verified this request and forwarded on
 *      a header (`lib/identity.ts`). Free — the answer is in memory. The proxy
 *      runs ahead of every matched request and strips any client-supplied value
 *      before setting its own, so trusting it here is trusting the proxy, not the
 *      caller.
 *   2. Failing that, `getUser()` — a network call to the Supabase Auth server,
 *      exactly as before.
 *
 * Keeping (2) is what makes this safe rather than merely fast: a route somehow
 * reached without the proxy still verifies properly instead of waving the caller
 * through. The change removes a redundant round trip; it never removes a check.
 *
 * The `req` parameter stays optional. Route handlers pass one (every existing
 * `currentUserId(req)` call site needed no edit); Server Components have no
 * `Request` to hand in and fall through to `headers()`, which carries the same
 * forwarded header.
 */
export async function currentUserId(req?: Request): Promise<string | null> {
  const forwarded = await forwardedUserId(req);
  if (forwarded !== null) return forwarded;

  const { data, error } = await (await supabaseSsr()).auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
}

/** The proxy's answer for this request, or null if it isn't there to read. */
async function forwardedUserId(req?: Request): Promise<string | null> {
  const fromRequest = req?.headers.get(IDENTITY_HEADER);
  if (fromRequest !== undefined && fromRequest !== null && fromRequest !== "") {
    return fromRequest;
  }
  try {
    const fromContext = (await headers()).get(IDENTITY_HEADER);
    return fromContext !== null && fromContext !== "" ? fromContext : null;
  } catch {
    // `headers()` throws outside a request scope. Not an error — just means
    // there is nothing forwarded to read, so fall through and ask the server.
    return null;
  }
}

/**
 * Exchanges the magic-link's PKCE `code` for a session, setting the cookie
 * server-side — the step today's client-only flow never performed. Returns the
 * error message, or null on success.
 */
export async function exchangeCodeForSession(code: string): Promise<string | null> {
  const { error } = await (await supabaseSsr()).auth.exchangeCodeForSession(code);
  return error?.message ?? null;
}
