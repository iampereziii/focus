"use client";

// The magic-link flow. It lives inside `lib/store/` for one reason: this is the
// only folder allowed to touch a Supabase client (eslint.config.mjs, guardrail
// (a)). Auth is not data access, but the guardrail is deliberately absolute —
// one hole is auditable, two is a convention.

import { supabaseBrowser } from "@/lib/supabase/browser";

/** Sends the magic link. Single user — there is no sign-up, no roles. */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabaseBrowser().auth.signInWithOtp({ email });
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

/**
 * The access token every API call carries as a bearer token.
 *
 * Route handlers validate it in `lib/store/auth-server.ts`. This getter lives here
 * for the same reason `sendMagicLink` does: `lib/store/` is the only folder
 * permitted to touch a Supabase client (eslint guardrail (a)), and the guardrail
 * is deliberately absolute — one hole is auditable, two is a convention.
 */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}
