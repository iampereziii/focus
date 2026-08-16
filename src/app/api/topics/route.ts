import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { createTopicByName, listTopics } from "@/lib/store/topics";
import { createTopicSchema } from "@/lib/validators";

/** GET — list topics. Feeds the capture picker and `/`'s grouping (Rule 12). */
export async function GET(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();
  try {
    return apiOk(await listTopics());
  } catch (err) {
    return apiFailure(err);
  }
}

/**
 * POST — create a topic from a NAME ONLY (`createTopicSchema`).
 *
 * `color` is assigned server-side from `PALETTE` in lib/store; `status` defaults
 * to `active`; `why` stays null (Rule 15 deferred with the topic board).
 *
 * Called INLINE from quick capture. It must not open a screen or add a step to
 * the capture path — one field, not a board. Capture is the friction-critical
 * path (Rule 9) and its 150 ms / under-20 s budgets include this call.
 *
 * RESOLVE-OR-CREATE (schema audit, 2026-08-17): `topics(lower(name))` is uniquely
 * indexed, so an existing name returns the existing row rather than a unique
 * violation. Erroring on "re-use a topic you already have" would put a failure on
 * the single most ordinary action in capture.
 *
 * NOTE: the topic BOARD is cut from v1 (`/topics` pages and components — Gap 1).
 * This route is the deliberate exception; do not delete it while removing them.
 * Rename / park / complete / re-colour return with the board in v1.1.
 */
export async function POST(req: Request): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const parsed = createTopicSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await createTopicByName(parsed.data.name), 201);
  } catch (err) {
    return apiFailure(err);
  }
}
