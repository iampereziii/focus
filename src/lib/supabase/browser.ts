import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
  cached = createClient(url, key);
  return cached;
}
