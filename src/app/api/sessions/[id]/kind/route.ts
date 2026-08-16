import { apiFailure, apiOk, invalidBody, unauthorized } from "@/lib/http";
import { currentUserId } from "@/lib/store/auth-server";
import { correctKind } from "@/lib/store/sessions";
import { correctKindSchema } from "@/lib/validators";

/**
 * PATCH — the WRITE-ONCE correction (Rule 21). Day review only.
 *
 * 409 if `kindCorrectedAt` is already set: write-once means the second attempt is
 * an error, not a silent overwrite. The ORIGINAL `kind` is never touched — that is
 * the whole point, and it is what keeps the mid-interrupt tap cheap.
 *
 * There is no default `kind` any more (Gap 24): the seven-cell grid makes every
 * interrupt an explicit choice among seven, so nothing is auto-tagged. The
 * correction pass survives anyway, because A WRONG TAP NEEDS FIXING JUST AS MUCH
 * AS A WRONG DEFAULT DID, and the research is explicit that in-the-moment
 * self-report catches only part of the picture.
 *
 * `drift` is a valid target (Gap 16) — it is the correction this pass most needs
 * to support ("that wasn't a pull, I just went sideways"), and omitting it would
 * have left the one label A9 says is systematically under-reported as the one
 * label unfixable. Correcting to `drift` moves the row into the `drift` bucket and
 * changes NOTHING structurally: no reparenting, no status rewrite on the parent.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if ((await currentUserId(req)) === null) return unauthorized();

  const { id } = await params;
  const parsed = correctKindSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error.issues);

  try {
    return apiOk(await correctKind(id, parsed.data.kindCorrectedTo));
  } catch (err) {
    return apiFailure(err);
  }
}
