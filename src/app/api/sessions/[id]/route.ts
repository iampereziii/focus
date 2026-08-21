import { apiError, apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { closeSession, sessionWithRelations } from "@/lib/store/sessions";
import { closeSessionSchema } from "@/lib/validators";

/**
 * GET — ONE session, with the row it interrupted and the rows that interrupted it.
 *
 * `/session/[id]` used to render itself from `GET /api/sessions?limit=100` and
 * find its row by scanning the flattened week tree: the whole recent log
 * downloaded to draw one screen, and any session past the hundredth unreachable
 * (feature-brief-write-path-latency-and-in-flight-feedback.md, Slice B —
 * discharging reactive-UI Risk 4).
 *
 * READ ONLY. It resolves a session; it never closes, classifies or resumes one —
 * the write half of this file is the PATCH below and stays the only one.
 *
 * Adding a GET here changes nothing about `EFFECTS` (`lib/api.ts`): that map is
 * keyed on write routes, and `tests/reactive-ui.test.ts` scans for POST and PATCH
 * exports only. A read invalidates nothing because it changes nothing.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  try {
    const found = await sessionWithRelations(id);
    if (found === null) return apiError(404, "not_found", "No session with that id.");
    return apiOk(found);
  } catch (err) {
    return apiFailure(err);
  }
}

/**
 * PATCH — CLOSE-OUT ONLY: `status` + `outcomeNote`.
 *
 * Rule 5: once `endedAt` is set, no field may change — including the outcome note.
 * A second attempt returns 409, not a silent overwrite. "Never edit a card after
 * the session. A tidied log is a useless log."
 *
 * `active` and `suspended` are absent from `closeSessionSchema` on purpose: this
 * endpoint closes, it does not reopen. Resuming is POST .../resume.
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
