"use client";

/**
 * The browser's API client.
 *
 * Every response is `{ data } | { error: { code, message } }` (Convention #5), so
 * this unwraps exactly that and nothing else. A raw array coming back from a route
 * is a bug in the route, not something to accommodate here.
 *
 * THE STATUS CODES CARRY MEANING and callers must branch on them rather than
 * showing a generic toast:
 *
 *   409 session_active     — Rule 1. Say WHICH session is blocking, with a link
 *                            to close it. Never close it silently.
 *   409 session_closed     — Rule 5. A closed session is immutable.
 *   409 rearm_cap_reached  — Rule 18. Present the forced disposition. NEVER
 *                            auto-close; Rule 7 has no exceptions.
 *   409 already_corrected  — Rule 21. Write-once.
 *   422 gate_incomplete    — Rules 2/3. Surface INLINE on the gate form.
 */

import { invalidate, type LiveKey } from "@/lib/live";

/**
 * WHICH `LiveKey`S A WRITTEN URL INVALIDATES (feature-brief-reactive-ui-writes-
 * invalidate-reads.md, Risk 7). Derived from the first path segment so no call
 * site ever has to remember to invalidate anything — the bug this brief fixes
 * is exactly that kind of forgetting. `push` has an entry deliberately: an
 * empty array records "checked, nothing to invalidate," not "forgotten" — that
 * distinction is what the wiring test in tests/reactive-ui.test.ts checks.
 */
export const EFFECTS: Record<string, readonly LiveKey[]> = {
  topics: ["topics"],
  tasks: ["tasks"],
  sessions: ["sessions", "active-session"],
  checkins: ["sessions"],
  push: [],
};

/**
 * One wrinkle first segment alone can't carry (Risk 7): starting, closing and
 * promoting a session all move a Task in or out of the backlog; re-arming,
 * disposing and correcting a `kind` do not. A URL's tail says which.
 */
export function keysFor(path: string): readonly LiveKey[] {
  const segment = path.split("/")[2];
  const base = segment !== undefined ? (EFFECTS[segment] ?? []) : [];
  const alsoMovesATask =
    path === "/api/sessions" ||
    path.endsWith("/resume") ||
    path.endsWith("/promote") ||
    /^\/api\/sessions\/[^/]+$/.test(path);
  return alsoMovesATask && !base.includes("tasks") ? [...base, "tasks"] : base;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Rule 1 — the UI must name the blocking session, not just fail. */
  get isActiveConflict(): boolean {
    return this.code === "session_active";
  }

  /** Rule 18 — the client must present a disposition, never close anything itself. */
  get isRearmCapped(): boolean {
    return this.code === "rearm_cap_reached";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // The session lives in a cookie now (`lib/supabase/browser.ts`'s `@supabase/ssr`
  // client) — same-origin fetch() sends it automatically, so there's no token to
  // attach here.
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const err =
      body !== null && typeof body === "object" && "error" in body
        ? (body.error as { code?: string; message?: string })
        : null;
    throw new ApiError(res.status, err?.code ?? "internal", err?.message ?? "Request failed");
  }

  if (body === null || typeof body !== "object" || !("data" in body)) {
    throw new ApiError(500, "internal", "Response was not in the { data } envelope");
  }
  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: async <T>(path: string, json?: unknown): Promise<T> => {
    const result = await request<T>(path, { method: "POST", body: JSON.stringify(json ?? {}) });
    // Invalidate on SUCCESS only — a failed write must not re-fetch unchanged
    // data and read like a no-op save (Gap 9 is adjacent to this).
    invalidate(...keysFor(path));
    return result;
  },
  patch: async <T>(path: string, json: unknown): Promise<T> => {
    const result = await request<T>(path, { method: "PATCH", body: JSON.stringify(json) });
    invalidate(...keysFor(path));
    return result;
  },
};
