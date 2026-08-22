import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-aware Supabase client factory — AUTH ONLY, same rule as the anon-key
 * browser client and the service-role server client next to it.
 *
 * DO NOT IMPORT THIS OUTSIDE `src/lib/store/` OR `src/proxy.ts`. Everything
 * that isn't the proxy goes through `src/lib/store/auth-server.ts`
 * (eslint.config.mjs guardrail (a)); the proxy gets an explicit exemption
 * because a Route Handler / Server Component can't refresh a cookie itself —
 * only the proxy, running ahead of every request, can.
 *
 * This is for reading *who is signed in*. It must never become a second way to
 * read `Task`/`Session`/`Topic` rows — `lib/supabase/server.ts`'s service-role
 * client stays the only data-access path.
 */

function env(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — see .env.example",
    );
  }
  return { url, key };
}

/**
 * For Server Components and Route Handlers.
 *
 * `setAll` is wrapped in a try/catch because a Server Component's render is
 * read-only — cookies can't be written there, and that's fine: `src/proxy.ts`
 * already refreshed the session cookie before this ever runs, on every request.
 * Route Handlers CAN write cookies, which is what the magic-link callback route
 * relies on.
 */
export async function supabaseSsr(): Promise<SupabaseClient> {
  const { url, key } = env();
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render — read-only, and fine; see above.
        }
      },
    },
  });
}

/**
 * For `src/proxy.ts` only — refreshes the session cookie on the response it returns.
 *
 * Returns a `finalize` step rather than a ready-made `response` because the proxy
 * now has something to say about the DOWNSTREAM REQUEST as well as the response:
 * it forwards its verified identity on a header so route handlers do not have to
 * re-ask the auth server (`lib/identity.ts`). That header can only be set once
 * `getUser()` has answered, i.e. after this factory returns — so the response is
 * built at the end, from headers the caller supplies, instead of eagerly here.
 *
 * Refreshed cookies are accumulated rather than applied immediately, then written
 * onto the one response `finalize` builds. Behaviourally identical to the previous
 * rebuild-on-every-setAll shape: `request.cookies.set` still updates the request's
 * own `cookie` header, so the headers handed to `finalize` already carry the
 * refreshed session for whatever runs downstream.
 */
export function supabaseSsrProxy(request: NextRequest): {
  supabase: SupabaseClient;
  finalize: (requestHeaders: Headers) => NextResponse;
} {
  const { url, key } = env();
  const refreshed: { name: string; value: string; options?: CookieOptions }[] = [];

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          refreshed.push({ name, value, options });
        }
      },
    },
  });

  const finalize = (requestHeaders: Headers): NextResponse => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    for (const { name, value, options } of refreshed) {
      response.cookies.set(name, value, options);
    }
    return response;
  };

  return { supabase, finalize };
}
