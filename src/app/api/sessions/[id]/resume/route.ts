import { apiFailure, apiOk, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { resumeSession } from "@/lib/store/sessions";
import { z } from "zod";

const resumeBody = z
  .object({
    childStatus: z.enum(["done", "partial", "switched", "abandoned"]).default("partial"),
    childOutcomeNote: z.string().trim().max(1000).nullable().default(null),
  })
  .default({ childStatus: "partial", childOutcomeNote: null });

/**
 * POST — resume a `suspended` parent. Closes/settles the live child and returns
 * the parent to `active`, in ONE transaction. 409 if another session is already
 * active, or if this one is not suspended.
 *
 * Rule 26g — THE CHECK-IN CLOCK RESETS TO ZERO and runs this session's own
 * interval again. A session suspended for three hours must not prompt the instant
 * it returns: that is what would train the prompt to be ignored. The reset IS the
 * answer to "resume is where I slip" — there is no separate post-resume nudge,
 * no second timer, and no number the app invented.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = resumeBody.safeParse(await req.json().catch(() => ({})));
  const body = parsed.success ? parsed.data : { childStatus: "partial" as const, childOutcomeNote: null };

  try {
    return apiOk(await resumeSession(id, body.childStatus, body.childOutcomeNote));
  } catch (err) {
    return apiFailure(err);
  }
}
