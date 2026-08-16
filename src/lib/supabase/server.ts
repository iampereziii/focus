import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client (service role).
 *
 * DO NOT IMPORT THIS OUTSIDE `src/lib/store/`. That is an ESLint error, not a
 * style preference — see eslint.config.mjs, guardrail (a), and ADR-0002.
 *
 * The service role key must never reach the client. `server-only` makes an
 * accidental client import a build error rather than a leak.
 *
 * Note: the service role BYPASSES RLS. That is fine and intended — RLS exists so
 * the anon key (which the browser holds, for auth) reads nothing while signed
 * out. See supabase/migrations/0001_init.sql § Row Level Security.
 */
export function supabaseServer(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — see .env.example",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
