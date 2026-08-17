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

/** `key: null` disables the fetch entirely (Risk 3). */
export function useLive<T>(key: LiveKey | null, fetcher: () => Promise<T>): SWRResponse<T> {
  return useSWR<T>(key, key === null ? null : fetcher);
}

export function invalidate(...keys: readonly LiveKey[]): void {
  for (const key of keys) void mutate(key);
}
