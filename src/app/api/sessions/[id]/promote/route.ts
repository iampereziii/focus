import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { promoteFiller } from "@/lib/store/sessions";
import { promoteSessionSchema } from "@/lib/validators";

/**
 * POST — the interrupt became the real work. Called on the FILLER CHILD's id.
 *
 * NO ROW'S `kind` IS EVER MUTATED (Gap 26). Promotion closes one session and opens
 * another, so Rule 21 stands absolutely and the immutability trigger stays the
 * simplest possible one. Four effects, one transaction:
 *
 *   1. close the FILLER CHILD  `switched` — the existing meaning of Rule 6's
 *      status: a session that ended because you moved to something else, with the
 *      move recorded rather than hidden. Its minutes stay visible as their own
 *      row, which is the number A10 is written against.
 *   2. create a Task from the child's `what` (topic defaults to `Inbox`)
 *   3. INSERT a new session, `kind = 'focus'`, `parentSessionId` = the CLOSED
 *      filler — the lineage record, so the chain reads grandparent → filler →
 *      promoted work
 *   4. close the GRANDPARENT with the submitted disposition (`partial` default)
 *
 * 422 without `why`/`finishLine` — PROMOTION IS THE GATE. Rules 2 and 3 are not
 * bypassed here, they are applied here, and the new row must satisfy the same
 * `kind = 'focus'` CHECK as any other session.
 *
 * 409 if the child is not `active` or the grandparent is not `suspended`.
 *
 * FRICTION IS UNCHANGED AND THAT IS WHY THE EARLIER REJECTION STILL HOLDS: Gap 17b
 * rejected "close and start over" because it cost the USER two forms. This is one
 * form — the close/create/close all happen server-side in a single transaction.
 *
 * Both ancestors end closed, so the depth walk stops immediately and a promoted
 * session does not count toward Rule 20's stack depth.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = promoteSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    const promoted = await promoteFiller({
      fillerId: id,
      why: parsed.data.why,
      finishLine: parsed.data.finishLine,
      checkInIntervalMinutes: parsed.data.checkInIntervalMinutes,
      grandparentStatus: parsed.data.grandparentStatus,
      topicId: parsed.data.topicId,
    });
    return apiOk(promoted, 201);
  } catch (err) {
    return apiFailure(err);
  }
}
