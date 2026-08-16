import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { closeSession } from "@/lib/store/sessions";
import { closeSessionSchema } from "@/lib/validators";

/**
 * PATCH — CLOSE-OUT ONLY: `status` + `outcomeNote`.
 *
 * Rule 5: once `endedAt` is set, no field may change — including the outcome note.
 * A second attempt returns 409, not a silent overwrite. "Never edit a card after
 * the session. A tidied log is a useless log."
 *
 * `active` and `suspended` are absent from `closeSessionSchema` on purpose: this
 * endpoint closes, it does not reopen. Resuming is POST .../resume; planning a
 * later resume is POST .../dispose (Rule 23).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = closeSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await closeSession(id, parsed.data.status, parsed.data.outcomeNote));
  } catch (err) {
    return apiFailure(err);
  }
}
