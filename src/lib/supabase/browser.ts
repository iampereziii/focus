import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (anon key) — AUTH ONLY.
 *
 * DO NOT IMPORT THIS OUTSIDE `src/lib/store/`. That is an ESLint error — see
 * eslint.config.mjs, guardrail (a), and ADR-0002.
 *
 * The anon key is client-safe because RLS is ENABLED on every table with the
 * predicate `auth.uid() IS NOT NULL` (spec Gap 22) — not because rows are
 * partitioned by owner. No table has a userId column.
 *
 * `@supabase/ssr`'s browser client (PKCE by default) writes the session to
 * COOKIES instead of localStorage — that's the swap this factory exists for.
 * It's what lets `src/proxy.ts` and every Server Component / Route Handler
 * read "who is signed in" without a bearer header (feature-brief-cookie-session-
 * ssr-swap.md).
 *
 * This exists for the magic-link flow. Data access does NOT happen here: reads
 * and writes go through `src/lib/store/` on the server.
 */
let cached: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY — see .env.example",
    );
  }
  cached = createBrowserClient(url, key);
  return cached;
}
