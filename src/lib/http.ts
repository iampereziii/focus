/**
 * The API error envelope, from the spec's NFR § Error Handling:
 *
 *     { error: { code, message } }
 *
 * Status codes that carry meaning in this app — the UI must respond to each one
 * specifically, not with a generic toast:
 *
 *   409  one-active-session conflict (Rule 1) — the UI must say WHICH session is
 *        blocking, with a link to close it
 *   409  edit to a closed session (Rule 5)
 *   409  4th `filler` re-arm (Rule 18) — the UI presents the forced disposition.
 *        NEVER an auto-close. Rule 7 is not negotiable here.
 *   409  second `kind` correction (Rule 21) — write-once means the second attempt
 *        is an error, not a silent overwrite
 *   409  resume of a session that isn't `suspended` (e.g. a promoted session's
 *        already-closed filler parent) — surfaced as a clean error, not a 500
 *   422  missing WHY or FINISH LINE (Rules 2, 3) — surfaced INLINE on the gate
 *        form, never as a toast
 *   422  promotion without WHY/FINISH LINE (Gap 17b) — promotion IS the gate
 *
 * Never expose stack traces to the client.
 */

export type ApiErrorCode =
  | "unauthorized"
  | "not_found"
  | "invalid_body"
  | "gate_incomplete"
  | "session_active"
  | "session_closed"
  | "session_not_suspended"
  | "rearm_cap_reached"
  | "already_corrected"
  | "not_implemented"
  | "internal";

export function apiError(
  status: number,
  code: ApiErrorCode,
  message: string,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Scaffold placeholder. Every route file in the tree exists so the structure is
 * settled before any feature code (Convention #1); each returns this until the
 * handler is written. Delete the call, not the file.
 */
export function notImplemented(rule: string): Response {
  return apiError(501, "not_implemented", `Not implemented yet — ${rule}`);
}

/**
 * The success half of the envelope. Convention #5: every response is
 * `{ data } | { error: { code, message } }` — never a raw array, never an ad-hoc
 * shape. A bare array is how a response shape starts drifting.
 */
export function apiOk<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status });
}

/**
 * Maps a thrown store error onto the envelope without leaking a stack trace.
 *
 * The Postgres constraints ARE the business rules, so their violations carry
 * meaning and must not all collapse into a 500:
 *
 *   sessions_single_active        → 409  Rule 1, one active session globally
 *   sessions_focus_is_gated       → 422  Rules 2/3, the WHY gate
 *   Rule 21 trigger               → 409  write-once correction / immutable kind
 *
 * Anything unrecognised is a genuine 500. Never expose the raw message for those.
 */
export function apiFailure(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("sessions_single_active")) {
    return apiError(
      409,
      "session_active",
      "Another session is already active. Close it before starting a new one (Rule 1).",
    );
  }
  if (message.includes("sessions_focus_is_gated")) {
    return apiError(
      422,
      "gate_incomplete",
      "A focus session needs a task, a WHY and a FINISH LINE (Rules 2, 3).",
    );
  }
  if (message.includes("Rule 21")) {
    return apiError(409, "already_corrected", message);
  }
  if (message.includes("Rule 5")) {
    return apiError(409, "session_closed", message);
  }
  // Rule 6, same class as Rule 5 and raised by the same kind of trigger: a write
  // aimed at a CLOSED session's checklist (0008_checklist_items.sql). A 500 here
  // would read as a bug when it is the immutability rule doing its job.
  if (message.includes("Rule 6")) {
    return apiError(409, "session_closed", message);
  }
  if (message.includes("Rule 18")) {
    return apiError(409, "rearm_cap_reached", message);
  }
  if (message.includes("is not suspended")) {
    return apiError(409, "session_not_suspended", message);
  }

  console.error("[focus] unhandled store error:", message);
  return apiError(500, "internal", "Something went wrong.");
}

/** 401 for every unauthenticated call. Protected surface is everything but `/login`. */
export function unauthorized(): Response {
  return apiError(401, "unauthorized", "Sign in first.");
}

/** 422 with Zod's issues flattened — surfaced INLINE on the form, never as a toast. */
export function invalidBody(issues: unknown): Response {
  return Response.json(
    {
      error: {
        code: "invalid_body" satisfies ApiErrorCode,
        message: "Request body failed validation.",
        issues,
      },
    },
    { status: 422 },
  );
}
