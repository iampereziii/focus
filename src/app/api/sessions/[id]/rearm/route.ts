import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { rearmFiller } from "@/lib/store/sessions";
import { fillerWaitMinutesSchema } from "@/lib/validators";
import { z } from "zod";

const rearmBody = z.object({ waitMinutes: fillerWaitMinutesSchema });

/**
 * POST — re-arm a `filler` return prompt for another interval (Rule 18).
 *
 * One tap re-arms; the app is silent in between. AFTER 3 RE-ARMS this returns 409
 * and the client MUST present a forced disposition — resume the parent, close it,
 * or promote the child. It must NEVER auto-close: Rule 7 has no exceptions and
 * this is not one.
 *
 * The tally lives in the stored `rearmCount` column (Gap 25) rather than in the
 * client, because a cap that silently resets on reload is worse than no cap — it
 * reads as working. It is also the evidence A10 needs at the 2026-09-05
 * checkpoint, where the action on falsification is to CUT `filler`, not tune it.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = rearmBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await rearmFiller(id, parsed.data.waitMinutes));
  } catch (err) {
    return apiFailure(err);
  }
}
