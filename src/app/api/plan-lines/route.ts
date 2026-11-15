import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { addPlanLine, listOpenPlan } from "@/lib/store/plan-lines";
import { createPlanLineSchema } from "@/lib/validators";

/**
 * GET — the OPEN plan: every line not yet ended, in the order written, plus its
 * `planDate`. There is NO date parameter. The plan is whichever one is open, and
 * whether it is stale is the browser's call (it alone knows the local date).
 *
 * This is NOT the cut `/api/plan/today` (spec Gaps 3 & 4) — that was an AI route
 * that ranked tasks. This returns the architect's own lines, unordered by the app.
 */
export async function GET(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();
  try {
    return apiOk(await listOpenPlan());
  } catch (err) {
    return apiFailure(err);
  }
}

/**
 * POST — add a line (`createPlanLineSchema`: `text` + the browser's `planDate`).
 *
 * 409 `plan_locked` when an EARLIER day's plan is still open (Rule 27b): the DB
 * trigger refuses it and `apiFailure` maps it. That is the architect's own rule
 * biting, not a fault — the UI says "end that day first" and offers End day.
 *
 * There is no PATCH and no DELETE for a line, on purpose (Rule 27c): a line is
 * written once; to change one you drop it and add another.
 */
export async function POST(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const parsed = createPlanLineSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await addPlanLine(parsed.data), 201);
  } catch (err) {
    return apiFailure(err);
  }
}
