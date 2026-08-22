/**
 * THE FORWARDED IDENTITY HEADER — one auth round trip per request, not two.
 *
 * `src/proxy.ts` already verifies the caller on EVERY request (it has to: only
 * the proxy can refresh the session cookie). Every route handler then called
 * `supabase.auth.getUser()` again, which is a second network call to the Supabase
 * Auth server for an answer the proxy already had. The proxy now forwards its
 * verified result on this header and `lib/store/auth-server.ts` reads it back
 * (feature-brief-write-path-latency-and-in-flight-feedback.md, Finding 1 /
 * Slice D, first half).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HEADER IS TRUSTED, SO THE PROXY MUST MAKE IT UNTRUSTWORTHY TO FORGE.
 *
 * A header a handler trusts is a header a client will try to set. `forwardedIdentity`
 * therefore always DELETES any inbound value before setting its own, and it is
 * the only thing that ever sets one. A request arriving with
 * `x-focus-user` already on it loses that value at the proxy, unconditionally,
 * whether or not the caller turns out to be signed in — which is why the delete
 * is not inside the `signedIn !== null` branch. `tests/write-path-latency.test.ts`
 * asserts exactly that and will fail if the two lines are ever reordered.
 *
 * `auth-server.ts` keeps its `getUser()` call as a FALLBACK for when the header is
 * absent, so a route reached without the proxy fails closed the old way rather
 * than failing open. (Brief Risk 3, resolved 2026-08-21.)
 *
 * This module holds no Supabase import on purpose: both `src/proxy.ts` and
 * `src/lib/store/` may import it without either widening the ADR-0002 guardrail.
 */

export const IDENTITY_HEADER = "x-focus-user";

/**
 * The request headers to forward downstream: the incoming set, with any
 * client-supplied identity stripped, plus the proxy's own verified answer.
 *
 * Pure and synchronous so the spoof-resistance property is unit-testable without
 * a Next.js runtime — the property is the reason this is a function at all.
 */
export function forwardedIdentity(incoming: Headers, signedInUserId: string | null): Headers {
  const headers = new Headers(incoming);
  // Unconditional, and BEFORE the set below. Never merge an inbound value.
  headers.delete(IDENTITY_HEADER);
  if (signedInUserId !== null) headers.set(IDENTITY_HEADER, signedInUserId);
  return headers;
}
