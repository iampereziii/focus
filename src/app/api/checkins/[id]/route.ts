import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { recordAnswer } from "@/lib/store/checkins";
import { answerCheckInSchema } from "@/lib/validators";

/**
 * PATCH — answer a check-in. "Still on <what>?" → Yes / Done / I drifted.
 *
 * ⚠️ ADDED 2026-08-17 (FOCUS-0). `answerCheckInSchema` existed with no route.
 *
 * THE APP ASKS; IT NEVER DECIDES (26b). This endpoint records the answer and
 * re-arms the probe clock, and does nothing else:
 *
 *   Yes      → re-armed for another interval. Nothing else changes.
 *   Done     → the CLIENT then navigates to close-out. This route does not close.
 *   drifted  → the CLIENT then closes the session `drifted`. This route does not.
 *
 * That separation is deliberate and load-bearing. An ignored prompt leaves the
 * session exactly as it was — no close, no status change, no escalation. Rule 7
 * has no exceptions and this is not one.
 *
 * ⚠️ OPEN SPEC QUESTION (FOCUS-0, Rule 26c) — THERE IS NO CAP ON CHECK-IN
 * RE-ARMS, and this is the most defensible reading, not a settled decision:
 *
 *   26c says the probe "reuses Rule 18's machinery verbatim … same capped re-arms
 *   ending in a forced disposition." Taken literally, answering "yes, still
 *   working" four times would force you to dispose of a session you are actively
 *   working on — which inverts the rule's purpose, contradicts 26b's "no
 *   escalation", and collides with Rule 7. `rearmCount` is also scoped "only
 *   meaningful when kind = 'filler'" (Gap 25), so no column exists to count
 *   against.
 *
 *   Implemented as: 26c means the same PROMPT IMPLEMENTATION, not the same cap.
 *   Rule 18's cap protects against a `filler` wait quietly becoming parallel work;
 *   a focus session answering "yes" has no equivalent failure mode. If the
 *   architect decides otherwise, this needs a counter column and a cap here.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = answerCheckInSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await recordAnswer(id, parsed.data.answer));
  } catch (err) {
    return apiFailure(err);
  }
}
