/**
 * The origin the magic link comes back to.
 *
 * `sendMagicLink` used to build `emailRedirectTo` from `window.location.origin`,
 * which meant a link requested from a local dev server pointed at
 * `http://localhost:3000/auth/callback` — a URL that only resolves on the machine
 * that asked for it. Open that link on a phone, or after the dev server is gone,
 * and sign-in dead-ends. The deployed app is the one origin that always answers,
 * so it is the default.
 *
 * `NEXT_PUBLIC_SITE_URL` overrides it when you genuinely want the link to land on
 * a local server (it must also be listed in Supabase's Auth → URL Configuration
 * redirect allow-list, same as the deployed origin).
 *
 * That allow-list is path-sensitive and fails silently, which is the trap. A bare
 * origin entry does NOT cover `/auth/callback` — the pattern has to be
 * `https://<origin>/**`. When no entry matches, Supabase does not error: it drops
 * `emailRedirectTo` and substitutes the project's Site URL. So a link whose
 * `redirect_to=` still says `http://localhost:3000` — origin only, no
 * `/auth/callback` path — is not this file misbehaving. It is the allow-list
 * rejecting the callback URL and the dashboard Site URL showing through. The path
 * is the tell: if `redirect_to` has one, the code chose it; if it doesn't, the
 * dashboard did.
 */
const DEPLOYED_ORIGIN = "https://focus-blue-psi.vercel.app";

/** Origin with no trailing slash, so callers can append a path directly. */
export function siteOrigin(): string {
  // Referenced as a static literal — Next.js inlines `NEXT_PUBLIC_*` at build
  // time only when it can see the full property access.
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  const origin =
    configured !== undefined && configured.trim() !== "" ? configured.trim() : DEPLOYED_ORIGIN;
  return origin.replace(/\/+$/, "");
}

/** `${siteOrigin()}/auth/callback`, the one URL the emailed link may return to. */
export function authCallbackUrl(): string {
  return `${siteOrigin()}/auth/callback`;
}
