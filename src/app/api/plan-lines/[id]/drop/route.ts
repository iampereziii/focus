import { z } from "zod";
import { apiError, apiFailure, apiOk, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { dropPlanLine } from "@/lib/store/plan-lines";

/**
 * POST — cross a line out. It STAYS VISIBLE (struck through) so the plan you wrote
 * in the morning is still readable in the evening; nothing is deleted, and there is
 * no delete endpoint for a plan line (Rule 27c, and Rule 14's instinct).
 *
 * Idempotent: dropping a dropped line returns it. 409 `plan_locked` for a line
 * that has been ended (frozen). 404 for an id that isn't a line.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  // A malformed id is "no such line", not a Postgres uuid-syntax 500.
  if (!z.uuid().safeParse(id).success) return apiError(404, "not_found", "No such plan line.");

  try {
    const line = await dropPlanLine(id);
    if (line === null) return apiError(404, "not_found", "No such plan line.");
    return apiOk(line);
  } catch (err) {
    return apiFailure(err);
  }
}
