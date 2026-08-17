"use client";

// The magic-link flow. It lives inside `lib/store/` for one reason: this is the
// only folder allowed to touch a Supabase client (eslint.config.mjs, guardrail
// (a)). Auth is not data access, but the guardrail is deliberately absolute —
// one hole is auditable, two is a convention.

import { supabaseBrowser } from "@/lib/supabase/browser";

/**
 * Sends the magic link. Single user — there is no sign-up, no roles.
 *
 * `emailRedirectTo` is required, not cosmetic: without it Supabase falls back to
 * the project's dashboard-configured Site URL, which has no reason to point at
 * `/auth/callback` specifically. Every other file in the cookie-session swap
 * (feature-brief-cookie-session-ssr-swap.md) was contained to server-only code —
 * this is the one line the swap needed here for the callback route to ever
 * receive a `code`.
 */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabaseBrowser().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  const { error } = await supabaseBrowser().auth.signOut();
  if (error) throw new Error(error.message);
}

/** Null when signed out. Everything except `/login` is behind this. */
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getUser();
  return data.user?.id ?? null;
}
