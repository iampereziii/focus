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

import { supabaseSsr } from "@/lib/supabase/ssr";

/**
 * Returns the user id, or null when the caller is not signed in.
 *
 * The `_req` parameter is unused — kept so every existing `currentUserId(req)`
 * call site in `src/app/api/**` needed no edit for the cookie swap — and is
 * optional so `(app)/page.tsx` and `(app)/layout.tsx` (Server Components, no
 * `Request` to hand in) can call `currentUserId()` directly.
 */
export async function currentUserId(_req?: Request): Promise<string | null> {
  const { data, error } = await (await supabaseSsr()).auth.getUser();
  if (error || !data.user) return null;
  return data.user.id;
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
