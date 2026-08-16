import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import {
  listSessionsPage,
  startFocusSession,
  suspendAndStartInterrupt,
} from "@/lib/store/sessions";
import { checkInsForSessions } from "@/lib/store/checkins";
import { groupByWeek } from "@/lib/facts";
import { startSessionSchema } from "@/lib/validators";

/**
 * GET — the log. Grouped/paginated by week; returns the parent/child TREE, not a
 * flat list. Never loads the full history — that is the second half of the build
 * gate (a week reconstructable in under 2 minutes).
 */
export async function GET(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 200);
  const before = url.searchParams.get("before") ?? undefined;

  try {
    const sessions = await listSessionsPage(limit, before);
    const checkIns = await checkInsForSessions(sessions.map((s) => s.id));
    return apiOk({ weeks: groupByWeek(sessions, checkIns, new Date()) });
  } catch (err) {
    return apiFailure(err);
  }
}

/**
 * POST — start a session. Body is a Zod DISCRIMINATED UNION on `kind`
 * (`startSessionSchema`). Three arms. Never a fourth.
 *
 *   kind: 'focus'
 *     422 if `why` / `finishLine` / `taskId` missing — THE GATE (Rules 2, 3).
 *         Surfaced INLINE on the gate form, never as a toast.
 *     409 if another session is active (Rule 1). The UI must say WHICH session is
 *         blocking, with a link to close it; the close records `switched`, so the
 *         switch is recorded rather than hidden (Rule 6).
 *
 *   kind: 'pulled' | 'filler'
 *     NO GATE. An interrupt cannot be asked for a WHY at the moment it arrives
 *     (ADR-0003 Invariant 3).
 *     SUSPENDS THE ACTIVE PARENT IN THE SAME TRANSACTION (Rule 16) — the parent
 *     is suspended, never closed. `suspended` is not `active`, so Rule 1's index
 *     survives verbatim (Rule 17).
 *     Rule 26f: the child INHERITS `checkInIntervalMinutes` from the parent.
 *     Rule 19: a parentless `pulled` is valid and gets a null interval.
 *     422 for `filler` without a parent and an expected wait (Rule 18).
 */
export async function POST(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const parsed = startSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);
  const input = parsed.data;

  try {
    if (input.kind === "focus") {
      return apiOk(await startFocusSession(input), 201);
    }

    const session = await suspendAndStartInterrupt({
      kind: input.kind,
      what: input.what,
      interruptTag: input.kind === "pulled" ? input.interruptTag : null,
      parentSessionId:
        input.kind === "filler" ? input.parentSessionId : (input.parentSessionId ?? null),
      waitMinutes: input.kind === "filler" ? input.waitMinutes : null,
    });
    return apiOk(session, 201);
  } catch (err) {
    return apiFailure(err);
  }
}
