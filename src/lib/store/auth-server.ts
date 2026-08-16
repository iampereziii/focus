import "server-only";

/**
 * Server-side auth check for route handlers.
 *
 * Single user, magic link, no roles (spec NFR § Authentication). Protected
 * surface is everything except `/login`.
 *
 * The browser holds the Supabase session and sends its access token as a bearer
 * token; this validates it. It lives in `lib/store/` because that is the only
 * folder permitted to touch a Supabase client (eslint guardrail (a)) — auth is
 * not data access, but the guardrail is deliberately absolute.
 *
 * Note the division of labour with RLS: the service-role client used everywhere
 * else BYPASSES RLS, so this function is what actually gates the API. RLS exists
 * so the anon key the browser holds reads nothing while signed out — belt and
 * braces, each covering what the other cannot.
 */

import { supabaseServer } from "@/lib/supabase/server";

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Returns the user id, or null when the caller is not signed in. */
export async function currentUserId(req: Request): Promise<string | null> {
  const token = bearerToken(req);
  if (token === null) return null;

  const { data, error } = await supabaseServer().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
