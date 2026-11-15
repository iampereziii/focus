import { apiFailure, apiOk, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { endDay } from "@/lib/store/plan-lines";

/**
 * POST — END DAY. Ends every open plan line in one statement and says how many.
 *
 * The architect's button, never a clock (Rule 27b, ADR-0004 Amendment 1): nothing
 * calls this on a schedule, and nothing may. It touches no session and no task, so
 * it is safe at any moment — and idempotent, so a second press returns `{ ended: 0 }`.
 *
 * No body: there is nothing to choose. It is not a "close the day" ritual with a
 * summary screen — `/review` was removed on purpose and this does not bring it back.
 */
export async function POST(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  try {
    return apiOk({ ended: await endDay() });
  } catch (err) {
    return apiFailure(err);
  }
}
