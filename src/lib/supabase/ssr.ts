import "server-only";

import { createServerClient } from "@supabase/ssr";
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

/** For `src/proxy.ts` only — refreshes the session cookie on the response it returns. */
export function supabaseSsrProxy(request: NextRequest): {
  supabase: SupabaseClient;
  response: NextResponse;
} {
  const { url, key } = env();
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });
  return { supabase, response };
}
