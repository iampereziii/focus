"use client";

/**
 * THE REACTIVE-UI SEAM (feature-brief-reactive-ui-writes-invalidate-reads.md).
 *
 * Writes announce what they changed; reads subscribe. `invalidate()` never holds
 * a response — it only tells a subscriber "go ask the server again." Anything
 * that answers a read from memory instead of re-fetching is ADR-0002 territory
 * (a cache), not this.
 *
 * Keys are coarse and named after domain nouns, not routes — a `sessions` write
 * re-reads every `sessions` subscriber regardless of which `/api/sessions/...`
 * URL each one actually calls (Risk 5, accepted). The mapping from a written URL
 * to the keys it invalidates lives beside `api.ts`'s `post`/`patch`, not here
 * (Risk 7) — this module only owns the subscription primitive.
 */

import useSWR, { mutate, type SWRResponse } from "swr";

export type LiveKey = "tasks" | "topics" | "sessions" | "active-session";

/**
 * `key: null` disables the fetch entirely (Risk 3).
 *
 * `scope` NARROWS THE SWR KEY WITHOUT NARROWING THE DOMAIN KEY, and it exists for
 * exactly one situation: a subscriber whose fetcher depends on something in the
 * URL. `/session/[id]` reads one session now rather than the whole log, so two
 * different session screens share the domain noun `sessions` but must not share a
 * cache entry — with a bare `"sessions"` key, navigating from one session to
 * another would leave SWR holding the previous session's response and no reason
 * to re-fetch, because the key never changed. Scoping makes the key
 * `["sessions", id]`.
 *
 * `invalidate("sessions")` still reaches every one of them — see below. The
 * EFFECTS map (`lib/api.ts`) is untouched by this and stays keyed on domain
 * nouns; nothing about a write's vocabulary changes.
 */
export function useLive<T>(
  key: LiveKey | null,
  fetcher: () => Promise<T>,
  scope?: string,
): SWRResponse<T> {
  const swrKey = key === null ? null : scope === undefined ? key : ([key, scope] as const);
  return useSWR<T>(swrKey, key === null ? null : fetcher);
}

/**
 * Re-reads every subscriber to these domain keys — scoped or not.
 *
 * The matcher form is what keeps scoping invisible to callers: a write announces
 * `sessions` exactly as it always did, and both `"sessions"` and
 * `["sessions", "<id>"]` are told to go ask the server again. A write must never
 * have to know which screen is mounted or what URL it is looking at.
 */
export function invalidate(...keys: readonly LiveKey[]): void {
  for (const key of keys) {
    void mutate(
      (swrKey: unknown) =>
        swrKey === key || (Array.isArray(swrKey) && swrKey.length > 0 && swrKey[0] === key),
    );
  }
}
