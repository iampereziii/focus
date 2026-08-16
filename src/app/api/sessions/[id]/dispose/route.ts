import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { disposeSuspended } from "@/lib/store/sessions";
import { disposeSuspendedSchema } from "@/lib/validators";

/**
 * POST — Rule 23's disposition. NOTHING SURVIVES THE DAY UNDECIDED.
 *
 * ⚠️ ADDED 2026-08-17 — this route is the writer FOCUS-0 identified as missing.
 * `resumeCue` and `resumePlannedAt` are in the Session field table and in
 * `disposeSuspendedSchema`, but nothing wrote them: `PATCH /api/sessions/[id]` is
 * close-out only, and `POST .../resume` resumes NOW, which is a different act from
 * planning to resume later. It is the same "nothing writes it" class as Gap 17.
 *
 * Three dispositions, one per suspended session:
 *
 *   resume  — the session STAYS `suspended`, but captures a WHEN. An EVENT CUE
 *             ("after standup", "next time I open this repo") is preferred over a
 *             clock time, plus a day/slot. The captured when is not decoration:
 *             it is what converts "resume tomorrow" from a wish into an
 *             implementation intention.
 *   partial — closed.
 *   abandon — closed.
 *
 * `resumePlannedAt` FIRES NOTHING. On the planned day the session simply sits at
 * the top of `/`. No notification, no second prompt class — Rule 26c already
 * forbids one, and this is the other place that would have been tempted.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = disposeSuspendedSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await disposeSuspended(id, parsed.data));
  } catch (err) {
    return apiFailure(err);
  }
}
